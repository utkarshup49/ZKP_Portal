/**
 * Shared chain types plus the browser-side client for the simulated ledger.
 *
 * This file is safe to import from client components. Server-only file I/O
 * lives in `chainStore.ts`, which the API routes use.
 */

import { poseidonHash, stringToField, toField, toHex } from "./poseidon";

export interface IssuerRecord {
  id: string;
  name: string;
  publicKey: string;
}

export interface BatchRecord {
  root: string;
  semesterId: string;
  issuerId: string;
  timestamp: string;
  leafCount: number;
  depth: number;
  /**
   * PLACEHOLDER. A real deployment verifies an ECDSA signature over
   * (root, semesterId, leafCount) against the issuer's registered public key
   * before accepting a root on chain. Here the field is a deterministic stand-in
   * and is not checked — see README, "What is simulated vs. what is real".
   */
  signature: string;
}

export interface RevocationRecord {
  leaf: string;
  root: string;
  semesterId: string;
  reason: string;
  revokedAt: string;
}

export interface ChainState {
  issuerRegistry: IssuerRecord[];
  batches: BatchRecord[];
  revoked: RevocationRecord[];
}

/* ------------------------------------------------------------------ */
/* Revocation accumulator                                              */
/* ------------------------------------------------------------------ */

/** Accumulator value for an empty revocation set. */
export const REVOCATION_EMPTY = poseidonHash([
  stringToField("zk-credentials/v1/revocation-empty"),
]);

/**
 * Fold the revocation set into a single field element.
 *
 * Leaves are sorted first, so the accumulator depends on the *set* of revoked
 * credentials and not on the order they were revoked in. The student commits to
 * this value when proving (having checked their own leaf is absent), and the
 * employer recomputes it from live chain state at verification time. That is
 * what lets the employer confirm non-revocation without ever learning which
 * leaf belongs to the holder.
 *
 * Consequence, and it is the honest one: any change to the revocation set makes
 * previously issued proofs stale. Accumulator-based revocation works this way in
 * practice — holders refresh their proof against the current accumulator.
 */
export function computeRevocationRoot(
  revoked: Array<{ leaf: string }>,
): string {
  const leaves = revoked
    .map((entry) => toField(entry.leaf))
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));

  let accumulator = REVOCATION_EMPTY;
  for (const leaf of leaves) {
    accumulator = poseidonHash([accumulator, leaf]);
  }
  return toHex(accumulator);
}

/** Find a published batch by root, tolerating case/padding differences. */
export function findBatchByRoot(
  state: ChainState,
  root: string,
): BatchRecord | undefined {
  let normalised: string;
  try {
    normalised = toHex(root);
  } catch {
    return undefined;
  }
  return state.batches.find((batch) => {
    try {
      return toHex(batch.root) === normalised;
    } catch {
      return false;
    }
  });
}

/** True when this exact leaf appears in the revocation list. */
export function isLeafRevoked(state: ChainState, leaf: string): boolean {
  let normalised: string;
  try {
    normalised = toHex(leaf);
  } catch {
    return false;
  }
  return state.revoked.some((entry) => {
    try {
      return toHex(entry.leaf) === normalised;
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Browser client                                                      */
/* ------------------------------------------------------------------ */

async function readJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body && typeof body.error === "string" && body.error) ||
      "Chain request failed with status " + response.status;
    throw new Error(message);
  }
  return body;
}

/** GET the full simulated ledger. */
export async function fetchChainState(): Promise<ChainState> {
  const response = await fetch("/api/chain/roots", { cache: "no-store" });
  return (await readJson(response)) as ChainState;
}

/**
 * POST a Merkle root on chain.
 *
 * Note what is transmitted: a root, a semester label and a leaf count. No
 * credential field of any student is part of this request.
 */
export async function publishRoot(params: {
  root: string;
  semesterId: string;
  leafCount: number;
  depth: number;
}): Promise<{ batch: BatchRecord; alreadyPublished: boolean }> {
  const response = await fetch("/api/chain/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await readJson(response);
  return {
    batch: body.batch as BatchRecord,
    alreadyPublished: Boolean(body.alreadyPublished),
  };
}

/** POST a leaf hash to the revocation list. */
export async function revokeLeaf(params: {
  leaf: string;
  root: string;
  semesterId: string;
  reason?: string;
}): Promise<RevocationRecord> {
  const response = await fetch("/api/chain/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await readJson(response);
  return body.revocation as RevocationRecord;
}
