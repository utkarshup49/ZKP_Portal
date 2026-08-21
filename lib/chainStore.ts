/**
 * SERVER ONLY — read/write the simulated ledger at `data/chain.json`.
 *
 * Stands in for the contract storage a real deployment would use. Never import
 * this from a client component; it touches `fs`.
 */

import { promises as fs } from "fs";
import path from "path";

import type { ChainState } from "./chain";
import { poseidonHash, toHex } from "./poseidon";

const CHAIN_FILE = path.join(process.cwd(), "data", "chain.json");

const EMPTY_STATE: ChainState = {
  issuerRegistry: [],
  batches: [],
  revoked: [],
};

/**
 * Writes are serialised through this promise chain. Next.js dev can handle two
 * requests concurrently, and a read-modify-write on a JSON file is not atomic.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export async function readChain(): Promise<ChainState> {
  try {
    const raw = await fs.readFile(CHAIN_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChainState>;
    return {
      issuerRegistry: parsed.issuerRegistry ?? [],
      batches: parsed.batches ?? [],
      revoked: parsed.revoked ?? [],
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { ...EMPTY_STATE };
    throw error;
  }
}

async function writeChain(state: ChainState): Promise<void> {
  await fs.mkdir(path.dirname(CHAIN_FILE), { recursive: true });
  await fs.writeFile(CHAIN_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Read-modify-write the ledger under a serialising queue. */
export async function updateChain<T>(
  mutate: (state: ChainState) => T | Promise<T>,
): Promise<T> {
  const run = writeQueue.then(async () => {
    const state = await readChain();
    const result = await mutate(state);
    await writeChain(state);
    return result;
  });
  // Keep the queue alive even when this operation rejects.
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * PLACEHOLDER signature over a batch.
 *
 * A real issuer signs (root, semesterId, leafCount) with the private key whose
 * public half sits in `issuerRegistry`, and the verifying contract rejects any
 * root whose ECDSA signature does not check out. This deterministic Poseidon
 * digest only *looks* like a signature; nothing verifies it.
 */
export function placeholderSignature(params: {
  root: string;
  semesterId: string;
  leafCount: number;
  issuerId: string;
}): string {
  const { root, semesterId, leafCount, issuerId } = params;
  let issuerField = 0n;
  for (const byte of new TextEncoder().encode(issuerId)) {
    issuerField = (issuerField << 8n) | BigInt(byte);
  }
  let semesterField = 0n;
  for (const byte of new TextEncoder().encode(semesterId).subarray(0, 31)) {
    semesterField = (semesterField << 8n) | BigInt(byte);
  }
  return toHex(poseidonHash([root, semesterField, leafCount, issuerField]));
}
