/**
 * Poseidon hashing wrapper.
 *
 * `poseidon-lite` is a pure-JS implementation of the Poseidon permutation over
 * the BN254 scalar field. It runs identically in Node (API routes, scripts) and
 * in the browser (student wallet), which is what lets the university, the
 * student and the employer all agree on the same field elements.
 *
 * Every hash in this project — leaves, Merkle nodes, identity commitments and
 * nullifiers — goes through this file. Nothing here is simulated.
 */

import {
  poseidon1,
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
  poseidon8,
} from "poseidon-lite";

/** BN254 scalar field modulus — the field every value below lives in. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type FieldLike = bigint | number | string;

type PoseidonFn = (inputs: bigint[]) => bigint;

const POSEIDON_BY_ARITY: Record<number, PoseidonFn> = {
  1: poseidon1 as PoseidonFn,
  2: poseidon2 as PoseidonFn,
  3: poseidon3 as PoseidonFn,
  4: poseidon4 as PoseidonFn,
  5: poseidon5 as PoseidonFn,
  6: poseidon6 as PoseidonFn,
  7: poseidon7 as PoseidonFn,
  8: poseidon8 as PoseidonFn,
};

/**
 * Coerce a bigint / integer / decimal string / 0x-hex string into a canonical
 * field element in [0, FIELD_MODULUS).
 */
export function toField(value: FieldLike): bigint {
  let raw: bigint;

  if (typeof value === "bigint") {
    raw = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`toField: expected an integer, received ${value}`);
    }
    raw = BigInt(value);
  } else {
    const trimmed = value.trim();
    if (trimmed === "") {
      throw new Error("toField: received an empty string");
    }
    try {
      raw = BigInt(trimmed);
    } catch {
      throw new Error(`toField: "${value}" is not a valid field element`);
    }
  }

  const reduced = raw % FIELD_MODULUS;
  return reduced < 0n ? reduced + FIELD_MODULUS : reduced;
}

/** Render a field element as a zero-padded 0x-prefixed 32-byte hex string. */
export function toHex(value: FieldLike): string {
  return "0x" + toField(value).toString(16).padStart(64, "0");
}

/** Poseidon over 1–8 field elements. */
export function poseidonHash(inputs: FieldLike[]): bigint {
  const fn = POSEIDON_BY_ARITY[inputs.length];
  if (!fn) {
    throw new Error(
      `poseidonHash: unsupported arity ${inputs.length} (supported: 1–8)`,
    );
  }
  return fn(inputs.map(toField));
}

/** Poseidon, rendered straight to hex. */
export function poseidonHex(inputs: FieldLike[]): string {
  return toHex(poseidonHash(inputs));
}

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("A Web Crypto implementation is required for randomness");
  }
  return c;
}

/**
 * Cryptographically random field element.
 *
 * `bytes` controls the entropy drawn before reduction: 32 bytes (256 bits) for
 * blinding factors `r`, 16 bytes (128 bits) for session nonces.
 */
export function randomFieldElement(bytes: number = 32): bigint {
  const buf = new Uint8Array(bytes);
  getCrypto().getRandomValues(buf);
  let acc = 0n;
  for (const b of buf) acc = (acc << 8n) | BigInt(b);
  return toField(acc);
}

/** Random value rendered as hex — used for `r` and for verifier nonces. */
export function randomFieldHex(bytes: number = 32): string {
  return toHex(randomFieldElement(bytes));
}

const STRING_DOMAIN = 0x7a6b2d63726564656e7469616c73n; // "zk-credentials"

/**
 * Deterministically map a UTF-8 string into the field by absorbing it in
 * 31-byte limbs. Used for domain separators and institution identifiers.
 */
export function stringToField(input: string): bigint {
  const bytes = new TextEncoder().encode(input);
  let acc = poseidonHash([STRING_DOMAIN, BigInt(bytes.length)]);
  for (let i = 0; i < bytes.length; i += 31) {
    let limb = 0n;
    for (const byte of bytes.subarray(i, i + 31)) {
      limb = (limb << 8n) | BigInt(byte);
    }
    acc = poseidonHash([acc, limb]);
  }
  return acc;
}

/** True when `value` parses as a canonical, non-zero 32-byte hex field element. */
export function isWellFormedFieldHex(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^0x[0-9a-f]{64}$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed > 0n && parsed < FIELD_MODULUS;
}
