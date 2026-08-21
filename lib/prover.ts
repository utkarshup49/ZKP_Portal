// STUB BOUNDARY — replace generateProof/verifyProof with snarkjs
// (groth16.fullProve / groth16.verify) once the Circom circuit is compiled.
// Everything else in this codebase stays unchanged.

/**
 * What is real in this file and what is not:
 *
 *   REAL   Poseidon identity-commitment check, leaf reconstruction, Merkle path
 *          folding, CGPA / degree / year constraints, nullifier derivation,
 *          revocation non-membership, on-chain root lookup, public-input
 *          binding. All of it is computed, and all of it can fail.
 *
 *   FAKE   The Groth16 curve points in `pi_a` / `pi_b` / `pi_c`. They are
 *          deterministic Poseidon-derived field elements shaped like a real
 *          proof. `verifyProof` checks their shape, not a pairing equation.
 *
 * The practical consequence: a student with CGPA 6.40 genuinely cannot produce
 * a proof against a threshold of 8.00 — `generateProof` throws. What a compiled
 * circuit would add is that a *malicious* student, running modified code,
 * still could not, because the pairing check would reject them.
 */

import {
  computeIdentityCommitment,
  computeLeaf,
  computeNullifier,
  degreeName,
  formatCgpa,
  intToCgpa,
  type CredentialBundle,
  type VerificationRequest,
} from "./credential";
import {
  computeRevocationRoot,
  fetchChainState,
  findBatchByRoot,
  isLeafRevoked,
  type ChainState,
} from "./chain";
import { computeRootFromPath } from "./merkle";
import { isWellFormedFieldHex, poseidonHash, toField, toHex } from "./poseidon";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PublicInputs {
  root: string;
  threshold: number;
  requiredDegreeCode: number;
  nonce: string;
  nullifier: string;
  /**
   * Accumulator over the chain's revocation set at proving time.
   *
   * This is a sixth public input beyond the four the verifier explicitly
   * requests. It exists because the employer must be able to confirm the
   * credential is not revoked *without* learning which leaf it is — publishing
   * the leaf would identify the holder among the batch and undo the privacy the
   * rest of the system buys. The holder checks non-membership and commits to
   * the accumulator; the verifier recomputes it from live chain state.
   */
  revocationRoot: string;
}

export interface Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  publicInputs: PublicInputs;
}

/** One line of the student-facing progress list. */
export interface ProofStep {
  index: number;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}

export interface GenerateProofOptions {
  /** Called as each step starts and finishes, so the UI can render progress. */
  onStep?: (step: ProofStep) => void;
  /** Pause between steps so a projector audience can follow along. */
  stepDelayMs?: number;
  /** Inject chain state instead of fetching it (used by the test script). */
  chainState?: ChainState;
}

/** Thrown when a constraint fails. Carries which step and which constraint. */
export class ProofConstraintError extends Error {
  readonly stepIndex: number;
  readonly stepLabel: string;
  readonly constraint: string;

  constructor(params: {
    stepIndex: number;
    stepLabel: string;
    constraint: string;
    message: string;
  }) {
    super(params.message);
    this.name = "ProofConstraintError";
    this.stepIndex = params.stepIndex;
    this.stepLabel = params.stepLabel;
    this.constraint = params.constraint;
  }
}

export function proofStepLabels(depth: number): string[] {
  return [
    "Verifying identity secret",
    "Reconstructing credential leaf",
    "Walking Merkle path (" + depth + " levels)",
    "Checking CGPA constraint",
    "Computing nullifier",
    "Generating proof",
  ];
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/* ------------------------------------------------------------------ */
/* Proof generation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a proof from a credential bundle against a verifier's request.
 *
 * `witness` is private and never leaves the browser. Only the returned `Proof`
 * — Groth16 points plus `publicInputs` — is ever transmitted.
 */
export async function generateProof(
  witness: CredentialBundle,
  request: VerificationRequest,
  options: GenerateProofOptions = {},
): Promise<Proof> {
  const { onStep, stepDelayMs = 0 } = options;
  const labels = proofStepLabels(witness.merkle.pathElements.length);

  const begin = (index: number) => {
    onStep?.({ index, label: labels[index], status: "running" });
  };
  const finish = (index: number, detail: string) => {
    onStep?.({ index, label: labels[index], status: "done", detail });
  };
  const fail = (index: number, constraint: string, message: string): never => {
    onStep?.({
      index,
      label: labels[index],
      status: "failed",
      detail: message,
    });
    throw new ProofConstraintError({
      stepIndex: index,
      stepLabel: labels[index],
      constraint,
      message,
    });
  };

  const { credential, secrets, merkle } = witness;

  /* -- Step 1: knowledge of the identity secret --------------------- */
  begin(0);
  await sleep(stepDelayMs);

  const derivedCommitment = computeIdentityCommitment(secrets.identitySecret);
  if (derivedCommitment !== toHex(credential.identityCommitment)) {
    fail(
      0,
      "identity",
      "Identity constraint failed: Poseidon(identitySecret) does not equal the " +
        "identity commitment in this credential. This wallet does not hold the " +
        "secret behind this credential.",
    );
  }
  finish(0, "Poseidon(identitySecret) matches the credential's commitment");

  /* -- Step 2: leaf reconstruction ---------------------------------- */
  begin(1);
  await sleep(stepDelayMs);

  const recomputedLeaf = computeLeaf(credential, secrets.r);
  if (recomputedLeaf !== toHex(merkle.leaf)) {
    fail(
      1,
      "leaf",
      "Leaf constraint failed: Poseidon(identityCommitment, cgpaInt, degreeCode, " +
        "year, institutionId, r) does not reproduce the leaf in this bundle. The " +
        "credential fields or the blinding factor have been altered.",
    );
  }
  finish(1, "Leaf " + truncateHex(recomputedLeaf) + " reconstructed from private fields");

  /* -- Step 3: Merkle inclusion ------------------------------------- */
  begin(2);
  await sleep(stepDelayMs);

  let foldedRoot: string;
  try {
    foldedRoot = toHex(
      computeRootFromPath(recomputedLeaf, merkle.pathElements, merkle.pathIndices),
    );
  } catch (error: any) {
    return fail(2, "merkle", "Merkle constraint failed: " + error.message);
  }

  if (foldedRoot !== toHex(merkle.root)) {
    fail(
      2,
      "merkle",
      "Merkle constraint failed: the authentication path folds to " +
        truncateHex(foldedRoot) +
        ", which is not the batch root " +
        truncateHex(merkle.root) +
        ". This leaf is not in the published tree.",
    );
  }
  finish(
    2,
    merkle.pathElements.length +
      " sibling hashes fold to root " +
      truncateHex(foldedRoot),
  );

  /* -- Step 4: predicate over the private fields -------------------- */
  begin(3);
  await sleep(stepDelayMs);

  if (credential.cgpaInt < request.threshold) {
    fail(
      3,
      "cgpa",
      "CGPA constraint failed: the credential does not satisfy " +
        "cgpaInt >= " +
        request.threshold +
        " (a CGPA of at least " +
        intToCgpa(request.threshold).toFixed(2) +
        "). No proof can be produced for this request.",
    );
  }

  if (credential.degreeCode !== request.requiredDegreeCode) {
    fail(
      3,
      "degree",
      "Attribute constraint failed: this credential is for " +
        degreeName(credential.degreeCode) +
        " (code " +
        credential.degreeCode +
        "), but the request requires " +
        degreeName(request.requiredDegreeCode) +
        " (code " +
        request.requiredDegreeCode +
        ").",
    );
  }

  if (credential.year < request.minYear || credential.year > request.maxYear) {
    fail(
      3,
      "year",
      "Year constraint failed: this credential was issued in " +
        credential.year +
        ", outside the requested range " +
        request.minYear +
        "-" +
        request.maxYear +
        ".",
    );
  }

  finish(
    3,
    "cgpaInt >= " +
      request.threshold +
      ", degree matches, year within " +
      request.minYear +
      "-" +
      request.maxYear,
  );

  /* -- Step 5: nullifier -------------------------------------------- */
  begin(4);
  await sleep(stepDelayMs);

  const nullifier = computeNullifier(secrets.identitySecret, request.nonce);
  finish(4, "Nullifier " + truncateHex(nullifier) + " bound to this session nonce");

  /* -- Step 6: assemble the proof ----------------------------------- */
  begin(5);
  await sleep(stepDelayMs);

  const chain = options.chainState ?? (await fetchChainState());

  const batch = findBatchByRoot(chain, merkle.root);
  if (!batch) {
    fail(
      5,
      "root",
      "Root constraint failed: batch root " +
        truncateHex(merkle.root) +
        " has not been published on chain. Ask the issuer to publish the batch first.",
    );
  }

  if (isLeafRevoked(chain, recomputedLeaf)) {
    fail(
      5,
      "revocation",
      "Revocation constraint failed: this credential has been revoked by the " +
        "issuer and appears in the on-chain revocation list. No valid proof exists for it.",
    );
  }

  const revocationRoot = computeRevocationRoot(chain.revoked);

  const publicInputs: PublicInputs = {
    root: toHex(merkle.root),
    threshold: request.threshold,
    requiredDegreeCode: request.requiredDegreeCode,
    nonce: toHex(request.nonce),
    nullifier,
    revocationRoot,
  };

  const proof: Proof = {
    ...synthesiseGroth16Points(recomputedLeaf, publicInputs),
    publicInputs,
  };

  finish(5, "Groth16 proof assembled over 6 public inputs");
  return proof;
}

/**
 * SIMULATED. Deterministic dummy curve points, derived by Poseidon from the
 * leaf and the public inputs.
 *
 * Poseidon is one-way, so nothing about the credential can be read back out of
 * these values. Replacing this with `groth16.fullProve(witness, wasm, zkey)` is
 * the whole of the remaining work.
 */
function synthesiseGroth16Points(
  leaf: string,
  publicInputs: PublicInputs,
): Pick<Proof, "pi_a" | "pi_b" | "pi_c"> {
  const seed = poseidonHash([
    leaf,
    publicInputs.root,
    publicInputs.threshold,
    publicInputs.requiredDegreeCode,
    publicInputs.nonce,
    publicInputs.nullifier,
  ]);

  // snarkjs emits decimal strings for curve coordinates; match that.
  const at = (i: number) => poseidonHash([seed, i]).toString();

  return {
    pi_a: [at(1), at(2), "1"],
    pi_b: [
      [at(3), at(4)],
      [at(5), at(6)],
      ["1", "0"],
    ],
    pi_c: [at(7), at(8), "1"],
  };
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export interface VerificationCheck {
  id: "root" | "publicInputs" | "nonce" | "revocation" | "proof";
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerificationReport {
  valid: boolean;
  checks: VerificationCheck[];
}

export interface VerifyProofOptions {
  chainState?: ChainState;
}

/**
 * Full verification with a per-check breakdown, for the employer's checklist.
 *
 * Every check but the last is a genuine computation against live chain state
 * and the request the employer issued.
 */
export async function verifyProofDetailed(
  proof: Proof,
  expectedRoot: string,
  expectedRequest: VerificationRequest,
  options: VerifyProofOptions = {},
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];
  const push = (check: VerificationCheck) => checks.push(check);

  const publicInputs = proof?.publicInputs;
  if (!publicInputs) {
    return {
      valid: false,
      checks: [
        {
          id: "proof",
          label: "Proof valid",
          ok: false,
          detail: "The submitted object has no publicInputs field.",
        },
      ],
    };
  }

  const chain = options.chainState ?? (await fetchChainState());

  /* -- 1. Root is on chain, and is the one we accept ---------------- */
  const batch = findBatchByRoot(chain, publicInputs.root);
  let expectedRootNormalised = "";
  try {
    expectedRootNormalised = toHex(expectedRoot);
  } catch {
    expectedRootNormalised = "";
  }

  if (!batch) {
    push({
      id: "root",
      label: "Root found on chain",
      ok: false,
      detail:
        "Root " +
        truncateHex(publicInputs.root) +
        " does not appear in any published batch.",
    });
  } else if (
    expectedRootNormalised &&
    toHex(batch.root) !== expectedRootNormalised
  ) {
    push({
      id: "root",
      label: "Root found on chain",
      ok: false,
      detail:
        "Proof is against root " +
        truncateHex(publicInputs.root) +
        ", but this session accepts " +
        truncateHex(expectedRoot) +
        ".",
    });
  } else {
    const issuer = chain.issuerRegistry.find((i) => i.id === batch.issuerId);
    push({
      id: "root",
      label: "Root found on chain",
      ok: true,
      detail:
        "Root " +
        truncateHex(batch.root) +
        " found on chain, published " +
        formatDate(batch.timestamp) +
        " by " +
        (issuer?.name ?? batch.issuerId) +
        " (" +
        batch.leafCount +
        " leaves).",
    });
  }

  /* -- 2. Public inputs match the request we issued ----------------- */
  const mismatches: string[] = [];
  if (publicInputs.threshold !== expectedRequest.threshold) {
    mismatches.push(
      "threshold " +
        publicInputs.threshold +
        " vs requested " +
        expectedRequest.threshold,
    );
  }
  if (publicInputs.requiredDegreeCode !== expectedRequest.requiredDegreeCode) {
    mismatches.push(
      "degree code " +
        publicInputs.requiredDegreeCode +
        " vs requested " +
        expectedRequest.requiredDegreeCode,
    );
  }
  push({
    id: "publicInputs",
    label: "Public inputs match this request",
    ok: mismatches.length === 0,
    detail:
      mismatches.length === 0
        ? "Threshold " +
          publicInputs.threshold +
          " (CGPA " +
          formatCgpa(publicInputs.threshold) +
          ") and degree " +
          degreeName(publicInputs.requiredDegreeCode) +
          " are exactly what was asked for."
        : "Proof was built for a different request: " + mismatches.join("; ") + ".",
  });

  /* -- 3. Nonce freshness ------------------------------------------- */
  let nonceOk = false;
  try {
    nonceOk = toHex(publicInputs.nonce) === toHex(expectedRequest.nonce);
  } catch {
    nonceOk = false;
  }
  push({
    id: "nonce",
    label: "Nonce matches this session",
    ok: nonceOk,
    detail: nonceOk
      ? "Nonce " +
        truncateHex(publicInputs.nonce) +
        " is the one issued in this session, so this proof cannot be replayed elsewhere."
      : "Nonce " +
        truncateHex(publicInputs.nonce) +
        " is not the one issued in this session. This proof was made for someone else's request.",
  });

  /* -- 4. Non-revocation -------------------------------------------- */
  const currentRevocationRoot = computeRevocationRoot(chain.revoked);
  let revocationOk = false;
  try {
    revocationOk = toHex(publicInputs.revocationRoot) === currentRevocationRoot;
  } catch {
    revocationOk = false;
  }
  push({
    id: "revocation",
    label: "Credential not present in revocation list",
    ok: revocationOk,
    detail: revocationOk
      ? chain.revoked.length === 0
        ? "The revocation list is empty, and the proof commits to that same empty accumulator."
        : "The holder proved non-membership against the current revocation set (" +
          chain.revoked.length +
          " entr" +
          (chain.revoked.length === 1 ? "y" : "ies") +
          ")."
      : "Revocation accumulator mismatch. The set has changed since this proof was " +
        "generated (now " +
        chain.revoked.length +
        " entr" +
        (chain.revoked.length === 1 ? "y" : "ies") +
        "), so the proof is stale. A fresh proof will only succeed if this " +
        "credential is not one of the revoked ones.",
  });

  /* -- 5. The SNARK itself ------------------------------------------ */
  const structural = checkProofShape(proof);
  push({
    id: "proof",
    label: "Proof valid",
    ok: structural.ok,
    detail: structural.ok
      ? "Groth16 object is well formed and the nullifier is a canonical field element. " +
        "(Simulated: a compiled circuit would run the pairing check here.)"
      : structural.detail,
  });

  return { valid: checks.every((check) => check.ok), checks };
}

/**
 * The signature the rest of the codebase is written against.
 *
 * Swap the body for `groth16.verify(vkey, publicSignals, proof)` plus the same
 * chain and request checks once the circuit exists.
 */
export async function verifyProof(
  proof: Proof,
  expectedRoot: string,
  expectedRequest: VerificationRequest,
  // Optional; omit it and chain state is fetched, which is the normal path.
  options: VerifyProofOptions = {},
): Promise<boolean> {
  const report = await verifyProofDetailed(
    proof,
    expectedRoot,
    expectedRequest,
    options,
  );
  return report.valid;
}

/**
 * SIMULATED stand-in for the pairing check: confirms the object has Groth16
 * shape, that every coordinate is a canonical field element, and that the
 * nullifier is well formed and non-zero.
 */
function checkProofShape(proof: Proof): { ok: boolean; detail: string } {
  const isFieldDecimal = (value: unknown) => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
    try {
      return toField(value).toString() === value;
    } catch {
      return false;
    }
  };

  if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 3) {
    return { ok: false, detail: "pi_a must be an array of three field elements." };
  }
  if (
    !Array.isArray(proof.pi_b) ||
    proof.pi_b.length !== 3 ||
    proof.pi_b.some((pair) => !Array.isArray(pair) || pair.length !== 2)
  ) {
    return { ok: false, detail: "pi_b must be a 3x2 array of field elements." };
  }
  if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 3) {
    return { ok: false, detail: "pi_c must be an array of three field elements." };
  }

  const coordinates = [...proof.pi_a, ...proof.pi_b.flat(), ...proof.pi_c];
  if (!coordinates.every(isFieldDecimal)) {
    return {
      ok: false,
      detail: "One or more curve coordinates are not canonical field elements.",
    };
  }

  if (!isWellFormedFieldHex(proof.publicInputs.nullifier)) {
    return {
      ok: false,
      detail:
        "Nullifier " +
        String(proof.publicInputs.nullifier) +
        " is not a canonical non-zero field element.",
    };
  }

  return { ok: true, detail: "" };
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export function truncateHex(value: string, lead = 6, tail = 4): string {
  if (typeof value !== "string") return String(value);
  if (value.length <= lead + tail + 3) return value;
  return value.slice(0, lead) + "…" + value.slice(-tail);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}
