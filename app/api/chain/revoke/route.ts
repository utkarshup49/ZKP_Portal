/**
 * POST /api/chain/revoke — add a leaf to the on-chain revocation list.
 *
 * A leaf hash is a commitment, not a credential: it reveals nothing about the
 * student's name, CGPA or degree without the blinding factor `r`, which the
 * issuer publishes to nobody. As with /publish, unknown fields are rejected.
 */

import { NextResponse } from "next/server";

import type { RevocationRecord } from "@/lib/chain";
import { updateChain } from "@/lib/chainStore";
import { toHex } from "@/lib/poseidon";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set(["leaf", "root", "semesterId", "reason"]);

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const unexpected = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) {
    return NextResponse.json(
      {
        error:
          "Unexpected field(s): " +
          unexpected.join(", ") +
          ". Only a leaf hash, its root, semesterId and a reason may be revoked on chain.",
      },
      { status: 400 },
    );
  }

  let leaf: string;
  let root: string;
  try {
    leaf = toHex(body.leaf);
    root = toHex(body.root);
  } catch {
    return NextResponse.json(
      { error: "leaf and root must be field elements in hex" },
      { status: 400 },
    );
  }

  try {
    const result = await updateChain((chain) => {
      const batch = chain.batches.find((entry) => {
        try {
          return toHex(entry.root) === root;
        } catch {
          return false;
        }
      });
      if (!batch) {
        throw new Error(
          "Root " + root + " is not published on chain; nothing to revoke against.",
        );
      }

      const existing = chain.revoked.find((entry) => {
        try {
          return toHex(entry.leaf) === leaf;
        } catch {
          return false;
        }
      });
      if (existing) {
        return { revocation: existing, alreadyRevoked: true };
      }

      const revocation: RevocationRecord = {
        leaf,
        root,
        semesterId: String(body.semesterId ?? batch.semesterId),
        reason: String(body.reason ?? "Revoked by issuer"),
        revokedAt: new Date().toISOString(),
      };

      chain.revoked.push(revocation);
      return { revocation, alreadyRevoked: false };
    });

    return NextResponse.json(result, { status: result.alreadyRevoked ? 200 : 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
