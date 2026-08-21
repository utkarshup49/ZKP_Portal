/**
 * GET /api/chain/roots — the full simulated ledger.
 *
 * Public data only: issuer registry, published Merkle roots, revocation list.
 * This is exactly what a light client would read from the contract.
 */

import { NextResponse } from "next/server";

import { readChain } from "@/lib/chainStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const chain = await readChain();
    return NextResponse.json(chain, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Could not read the ledger: " + error.message },
      { status: 500 },
    );
  }
}
