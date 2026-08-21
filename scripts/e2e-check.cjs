/**
 * Headless walk through the acceptance criteria.
 *
 *   npm run check:e2e
 *
 * Runs the real library code — Poseidon, the Merkle tree, every constraint in
 * generateProof, and verifyProof — with the chain injected instead of fetched.
 * If this passes, the browser flow works for the same reasons.
 */

const fs = require("fs");
const path = require("path");

const credential = require("../.tmp/credential.js");
const merkle = require("../.tmp/merkle.js");
const prover = require("../.tmp/prover.js");
const { toHex } = require("../.tmp/poseidon.js");

let failures = 0;
let checks = 0;

function ok(condition, label, extra) {
  checks += 1;
  if (condition) {
    console.log("  ✓ " + label);
  } else {
    failures += 1;
    console.log("  ✗ " + label + (extra ? "\n      " + extra : ""));
  }
}

function section(title) {
  console.log("\n" + title);
}

/* ------------------------------------------------------------------ */
/* Set-up: issue the sample batch                                      */
/* ------------------------------------------------------------------ */

const csv = fs.readFileSync(
  path.join(__dirname, "..", "data", "sample-students.csv"),
  "utf8",
);
const students = credential.parseStudentsCsv(csv);
const issued = students.map((student, index) =>
  credential.issueCredential(student, index),
);
const tree = merkle.buildMerkleTree(issued.map((entry) => entry.leaf));
const root = toHex(tree.root);

const chain = {
  issuerRegistry: [
    { id: "BITM", name: "Birla Institute of Technology, Mesra", publicKey: "0x00" },
  ],
  batches: [
    {
      root,
      semesterId: "2027-SPRING",
      issuerId: "BITM",
      timestamp: new Date().toISOString(),
      leafCount: tree.leafCount,
      depth: tree.depth,
      signature: "0x00",
    },
  ],
  revoked: [],
};

function bundleFor(rollNumber) {
  const entry = issued.find((item) => item.rollNumber === rollNumber);
  if (!entry) throw new Error("No such student: " + rollNumber);
  const proofPath = merkle.getMerkleProof(tree, entry.leafIndex);
  return credential.parseBundle(
    credential.buildBundle({
      issued: entry,
      semesterId: "2027-SPRING",
      root,
      depth: tree.depth,
      leafCount: tree.leafCount,
      pathElements: proofPath.pathElements,
      pathIndices: proofPath.pathIndices,
    }),
  );
}

function makeRequest(overrides) {
  return Object.assign(
    {
      requestId: "req-test",
      verifierName: "Acme Systems (hiring)",
      threshold: 800,
      requiredDegreeCode: 1101,
      minYear: 2023,
      maxYear: 2027,
      nonce: credential.randomNonce(),
      issuedAt: new Date().toISOString(),
    },
    overrides || {},
  );
}

/* ------------------------------------------------------------------ */

section("Roster and tree");
ok(students.length === 20, "20 sample students parsed");
ok(
  students.filter((s) => s.cgpa >= 8).length >= 12,
  "at least 12 students at or above CGPA 8.00",
);
ok(
  students.filter((s) => s.cgpa < 8).length >= 5,
  "at least 5 students below CGPA 8.00",
);
ok(
  new Set(students.map((s) => s.degreeCode)).size >= 2,
  "more than one degree code present",
);
ok(tree.leafCount === 32 && tree.depth === 5, "20 leaves padded to depth 5 / 32 slots");
ok(
  tree.layers[0].slice(20).every((leaf) => leaf === merkle.EMPTY_LEAF),
  "padding slots use Poseidon(dummy), not zero",
);
ok(merkle.EMPTY_LEAF !== 0n, "the padding leaf is non-zero");

section("Merkle paths are genuine");
const sample = bundleFor("BTECH/27431/23");
ok(
  merkle.verifyMerkleProof(
    sample.merkle.leaf,
    sample.merkle.pathElements,
    sample.merkle.pathIndices,
    root,
  ),
  "authentication path folds to the published root",
);
ok(
  !merkle.verifyMerkleProof(
    sample.merkle.leaf,
    sample.merkle.pathElements.slice().reverse(),
    sample.merkle.pathIndices,
    root,
  ),
  "a scrambled path does not fold to the root",
);
ok(
  sample.merkle.pathElements.length === 5,
  "path has one sibling per level (5)",
);

/* ------------------------------------------------------------------ */

async function main() {
  section("Criterion 4 — proof succeeds for CGPA 8.34, all six steps");
  const aarav = bundleFor("BTECH/27431/23");
  ok(aarav.credential.cgpaInt === 834, "the demo student's CGPA is 8.34");

  const request = makeRequest();
  const seen = [];
  const proof = await prover.generateProof(aarav, request, {
    chainState: chain,
    onStep: (step) => {
      if (step.status === "done") seen.push(step.label);
    },
  });
  ok(seen.length === 6, "all six steps completed", "saw: " + seen.join(" | "));
  ok(
    seen[2] === "Walking Merkle path (5 levels)",
    "step 3 reports the real tree depth",
  );

  section("Criterion 5 — no CGPA anywhere in what the employer receives");
  const publicKeys = Object.keys(proof.publicInputs).sort();
  ok(
    JSON.stringify(publicKeys) ===
      JSON.stringify([
        "nonce",
        "nullifier",
        "requiredDegreeCode",
        "revocationRoot",
        "root",
        "threshold",
      ]),
    "publicInputs holds only the agreed fields",
    publicKeys.join(","),
  );
  const publicValues = Object.values(proof.publicInputs).map(String);
  ok(
    !publicValues.includes("834") && !publicValues.includes("8.34"),
    "the actual CGPA appears in no public input",
  );
  ok(
    proof.publicInputs.threshold === 800,
    "only the threshold the employer asked for is present",
  );
  const serialised = JSON.stringify(proof);
  for (const secret of [
    aarav.secrets.r,
    aarav.secrets.identitySecret,
    aarav.merkle.leaf,
    aarav.credential.rollNumber,
    aarav.credential.name,
  ]) {
    ok(!serialised.includes(secret), "proof does not contain " + secret.slice(0, 24));
  }

  section("Criterion 6 — verification returns TRUE with every check green");
  const report = await prover.verifyProofDetailed(proof, root, request, {
    chainState: chain,
  });
  ok(report.valid === true, "verifyProofDetailed reports valid");
  ok(report.checks.length === 5, "five checklist items");
  for (const check of report.checks) {
    ok(check.ok, "check: " + check.label, check.detail);
  }
  ok(
    (await prover.verifyProof(proof, root, request, { chainState: chain })) === true,
    "verifyProof returns true",
  );

  section("Criterion 7 — CGPA 6.40 cannot produce a proof");
  const karan = bundleFor("BTECH/27155/23");
  ok(karan.credential.cgpaInt === 640, "the low-CGPA student is at 6.40");
  let caught = null;
  try {
    await prover.generateProof(karan, makeRequest(), { chainState: chain });
  } catch (err) {
    caught = err;
  }
  ok(caught !== null, "generateProof threw");
  ok(
    caught && caught.name === "ProofConstraintError",
    "threw a ProofConstraintError",
  );
  ok(caught && caught.constraint === "cgpa", "failed on the cgpa constraint");
  ok(caught && caught.stepIndex === 3, "failed at step 4 (Checking CGPA constraint)");
  ok(
    caught && /does not satisfy/.test(caught.message),
    "message names the failing comparison",
    caught && caught.message,
  );

  section("Attribute mismatch — high CGPA, wrong degree");
  const nikhil = bundleFor("BTECH/27633/23");
  let degreeError = null;
  try {
    await prover.generateProof(nikhil, makeRequest(), { chainState: chain });
  } catch (err) {
    degreeError = err;
  }
  ok(
    degreeError && degreeError.constraint === "degree",
    "CGPA 9.20 in B.Tech ECE still fails the degree constraint",
  );

  section("Year range constraint");
  let yearError = null;
  try {
    await prover.generateProof(aarav, makeRequest({ minYear: 2020, maxYear: 2024 }), {
      chainState: chain,
    });
  } catch (err) {
    yearError = err;
  }
  ok(yearError && yearError.constraint === "year", "out-of-range year is rejected");

  section("Tampering — soundness of the non-SNARK constraints");
  const forged = JSON.parse(JSON.stringify(aarav));
  forged.credential.cgpaInt = 999;
  let forgeError = null;
  try {
    await prover.generateProof(forged, makeRequest(), { chainState: chain });
  } catch (err) {
    forgeError = err;
  }
  ok(
    forgeError && forgeError.constraint === "leaf",
    "editing the CGPA in the bundle breaks leaf reconstruction",
  );

  const swapped = JSON.parse(JSON.stringify(aarav));
  swapped.secrets.identitySecret = credential.deriveDemoIdentitySecret("SOMEONE/ELSE/00");
  let identityError = null;
  try {
    await prover.generateProof(swapped, makeRequest(), { chainState: chain });
  } catch (err) {
    identityError = err;
  }
  ok(
    identityError && identityError.constraint === "identity",
    "a wrong identity secret fails before anything else",
  );

  const unpublished = JSON.parse(JSON.stringify(aarav));
  let rootError = null;
  try {
    await prover.generateProof(unpublished, makeRequest(), {
      chainState: { issuerRegistry: [], batches: [], revoked: [] },
    });
  } catch (err) {
    rootError = err;
  }
  ok(
    rootError && rootError.constraint === "root",
    "an unpublished root cannot be proven against",
  );

  section("Replay — a proof is bound to its session nonce");
  const otherSession = makeRequest();
  const replayReport = await prover.verifyProofDetailed(proof, root, otherSession, {
    chainState: chain,
  });
  ok(replayReport.valid === false, "proof from another session is rejected");
  ok(
    replayReport.checks.find((c) => c.id === "nonce").ok === false,
    "the nonce check is the one that fails",
  );

  section("Wrong-request binding");
  const stricter = Object.assign({}, request, { threshold: 900 });
  const strictReport = await prover.verifyProofDetailed(proof, root, stricter, {
    chainState: chain,
  });
  ok(strictReport.valid === false, "a proof for CGPA>=8.0 does not answer CGPA>=9.0");
  ok(
    strictReport.checks.find((c) => c.id === "publicInputs").ok === false,
    "the public-inputs check catches it",
  );

  section("Criterion 8 — revocation");
  const revokedChain = JSON.parse(JSON.stringify(chain));
  revokedChain.revoked.push({
    leaf: aarav.merkle.leaf,
    root,
    semesterId: "2027-SPRING",
    reason: "Revoked by registrar",
    revokedAt: new Date().toISOString(),
  });

  const afterRevocation = await prover.verifyProofDetailed(proof, root, request, {
    chainState: revokedChain,
  });
  ok(afterRevocation.valid === false, "re-verifying the old proof returns FALSE");
  const revocationCheck = afterRevocation.checks.find((c) => c.id === "revocation");
  ok(revocationCheck.ok === false, "it fails at the revocation check");
  ok(
    afterRevocation.checks.filter((c) => !c.ok).length === 1,
    "and only at the revocation check",
    afterRevocation.checks.filter((c) => !c.ok).map((c) => c.id).join(","),
  );

  let regenError = null;
  try {
    await prover.generateProof(aarav, makeRequest(), { chainState: revokedChain });
  } catch (err) {
    regenError = err;
  }
  ok(
    regenError && regenError.constraint === "revocation",
    "a fresh proof for the revoked credential is impossible too",
  );

  const other = bundleFor("BTECH/27102/23");
  const otherRequest = makeRequest();
  const otherProof = await prover.generateProof(other, otherRequest, {
    chainState: revokedChain,
  });
  const otherReport = await prover.verifyProofDetailed(
    otherProof,
    root,
    otherRequest,
    { chainState: revokedChain },
  );
  ok(
    otherReport.valid === true,
    "an unrevoked classmate can still prove against the updated accumulator",
  );

  section("Nullifier behaviour");
  const nonce = credential.randomNonce();
  const a = credential.computeNullifier(aarav.secrets.identitySecret, nonce);
  const b = credential.computeNullifier(aarav.secrets.identitySecret, nonce);
  const c = credential.computeNullifier(
    aarav.secrets.identitySecret,
    credential.randomNonce(),
  );
  ok(a === b, "same secret and nonce give the same nullifier");
  ok(a !== c, "a different nonce gives an unlinkable nullifier");

  /* ---------------------------------------------------------------- */

  console.log(
    "\n" +
      (failures === 0 ? "PASS" : "FAIL") +
      " — " +
      (checks - failures) +
      "/" +
      checks +
      " checks passed.\n",
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nUnexpected error:\n", err);
  process.exit(1);
});
