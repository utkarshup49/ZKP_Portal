/**
 * Tab-to-tab handoff for the demo.
 *
 * localStorage carries the *public* artefacts only — the employer's request and
 * the student's finished proof. Both are things that would travel over the
 * network in a real deployment, so parking them in shared browser storage
 * changes nothing about the security story.
 *
 * The credential itself is deliberately NOT here. It lives in React state on
 * the student page and is gone on refresh, which is the point: the credential
 * lives on the device, not in a store some other page can read.
 */

import type { VerificationRequest } from "./credential";
import type { Proof } from "./prover";

export const REQUEST_KEY = "zk-credentials/pending-request";
export const PROOF_KEY = "zk-credentials/pending-proof";
/**
 * The verifier's own copy of the request it issued, so switching portals inside
 * a single tab does not lose the session. Public data, same as REQUEST_KEY.
 */
export const EMPLOYER_SESSION_KEY = "zk-credentials/employer-session";

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function putPendingRequest(request: VerificationRequest): void {
  write(REQUEST_KEY, request);
}

export function getPendingRequest(): VerificationRequest | null {
  return read<VerificationRequest>(REQUEST_KEY);
}

export function putPendingProof(proof: Proof): void {
  write(PROOF_KEY, proof);
}

export function getPendingProof(): Proof | null {
  return read<Proof>(PROOF_KEY);
}

export function putEmployerSession(request: VerificationRequest): void {
  write(EMPLOYER_SESSION_KEY, request);
}

export function getEmployerSession(): VerificationRequest | null {
  return read<VerificationRequest>(EMPLOYER_SESSION_KEY);
}

export function clearPendingProof(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROOF_KEY);
}
