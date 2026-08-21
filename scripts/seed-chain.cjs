/**
 * Write a fresh data/chain.json (and data/chain.seed.json).
 *
 *   npm run reset:chain
 *
 * The ledger starts with the issuer registry populated and one historical batch
 * from the previous semester, so the Blockchain Explorer is not empty on first
 * load. The demo then publishes 2027-SPRING itself.
 */

const fs = require("fs");
const path = require("path");

const { poseidonHash, stringToField, toHex } = require("../.tmp/poseidon.js");

function fieldFromString(value) {
  return toHex(stringToField(value));
}

// PLACEHOLDER — mirrors placeholderSignature() in lib/chainStore.ts. Nothing
// verifies these; a real deployment checks an ECDSA signature against the
// issuer registry before accepting a root.
function placeholderSignature({ root, semesterId, leafCount, issuerId }) {
  const bytesToField = (text, limit) => {
    let acc = 0n;
    for (const byte of new TextEncoder().encode(text).subarray(0, limit)) {
      acc = (acc << 8n) | BigInt(byte);
    }
    return acc;
  };
  return toHex(
    poseidonHash([
      root,
      bytesToField(semesterId, 31),
      leafCount,
      bytesToField(issuerId, 31),
    ]),
  );
}

const historicalRoot = toHex(
  poseidonHash([stringToField("historical-batch:2026-AUTUMN"), 256]),
);

const chain = {
  issuerRegistry: [
    {
      id: "BITM",
      name: "Birla Institute of Technology, Mesra",
      // PLACEHOLDER public key. A real registry holds the issuer's actual
      // secp256k1 public key, and roots are only accepted with a matching
      // ECDSA signature.
      publicKey: fieldFromString("issuer-public-key:BITM"),
    },
  ],
  batches: [
    {
      root: historicalRoot,
      semesterId: "2026-AUTUMN",
      issuerId: "BITM",
      timestamp: "2026-11-28T09:15:00.000Z",
      leafCount: 256,
      depth: 8,
      signature: placeholderSignature({
        root: historicalRoot,
        semesterId: "2026-AUTUMN",
        leafCount: 256,
        issuerId: "BITM",
      }),
    },
  ],
  revoked: [],
};

const body = JSON.stringify(chain, null, 2) + "\n";
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "chain.json"), body, "utf8");
fs.writeFileSync(path.join(dataDir, "chain.seed.json"), body, "utf8");

console.log("Reset data/chain.json (1 historical batch, 0 revocations).");
