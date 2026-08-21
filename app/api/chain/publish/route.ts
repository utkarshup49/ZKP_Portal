/**
 * POST /api/chain/publish — publish a batch Merkle root.
 *
 * The request body is deliberately tiny: a root, a semester label, a leaf count
 * and a depth. No student name, roll number, CGPA, blinding factor or leaf ever
 * crosses this boundary. The allow-list below rejects any extra field outright,
 * so an accidental credential leak fails loudly instead of going unnoticed.
 */

import { NextResponse } from "next/server";

import type { BatchRecord } from "@/lib/chain";
import { placeholderSignature, updateChain } from "@/lib/chainStore";
import { ISSUER_ID } from "@/lib/credential";
import { toHex } from "@/lib/poseidon";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set(["root", "semesterId", "leafCount", "depth"]);

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
          ". Only a root, semesterId, leafCount and depth may be published on chain.",
      },
      { status: 400 },
    );
  }

  let root: string;
  try {
    root = toHex(body.root);
  } catch {
    return NextResponse.json(
      { error: "root must be a field element in hex" },
      { status: 400 },
    );
  }

  const semesterId = String(body.semesterId ?? "").trim();
  if (!semesterId) {
    return NextResponse.json({ error: "semesterId is required" }, { status: 400 });
  }

  const leafCount = Number(body.leafCount);
  const depth = Number(body.depth);
  if (!Number.isInteger(leafCount) || leafCount <= 0) {
    return NextResponse.json(
      { error: "leafCount must be a positive integer" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(depth) || depth <= 0) {
    return NextResponse.json(
      { error: "depth must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await updateChain((chain) => {
      const existing = chain.batches.find((batch) => {
        try {
          return toHex(batch.root) === root;
        } catch {
          return false;
        }
      });
      if (existing) {
        return { batch: existing, alreadyPublished: true };
      }

      const batch: BatchRecord = {
        root,
        semesterId,
        issuerId: ISSUER_ID,
        timestamp: new Date().toISOString(),
        leafCount,
        depth,
        // PLACEHOLDER — a real contract verifies an ECDSA signature over this
        // batch against issuerRegistry before accepting the root.
        signature: placeholderSignature({
          root,
          semesterId,
          leafCount,
          issuerId: ISSUER_ID,
        }),
      };

      chain.batches.push(batch);
      return { batch, alreadyPublished: false };
    });

    return NextResponse.json(result, { status: result.alreadyPublished ? 200 : 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Could not write to the ledger: " + error.message },
      { status: 500 },
    );
  }
}
