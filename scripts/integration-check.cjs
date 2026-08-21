/**
 * Integration walk against a RUNNING dev server.
 *
 *   npm run dev            # in one terminal
 *   npm run check:http     # in another
 *
 * Same library code the browser runs, but the chain is reached over real HTTP
 * instead of being injected. Every outbound request body is recorded and then
 * audited for credential leakage — this is the automated form of the
 * "check that no network request contains a CGPA" requirement.
 */

const fs = require("fs");
const path = require("path");

const credential = require("../.tmp/credential.js");
const merkle = require("../.tmp/merkle.js");
const prover = require("../.tmp/prover.js");
const { toHex } = require("../.tmp/poseidon.js");

const BASE = process.env.BASE_URL || "http://localhost:3000";

let failures = 0;
let checks = 0;
const wire = [];

function ok(condition, label, extra) {
  checks += 1;
  console.log((condition ? "  ✓ " : "  ✗ ") + label + (!condition && extra ? "\n      " + extra : ""));
  if (!condition) failures += 1;
}

function section(title) {
  console.log("\n" + title);
}

/* Resolve the app's relative URLs and record every request. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const absolute = url.startsWith("http") ? url : BASE + url;
  wire.push({
    url: absolute,
    method: (init && init.method) || "GET",
    body: (init && init.body) || null,
  });
  return realFetch(absolute, init);
};

async function main() {
  section("Set-up — issue and publish a batch over HTTP");

  const csv = fs.readFileSync(
    path.join(__dirname, "..", "data", "sample-students.csv"),
    "utf8",
  );
  const students = credential.parseStudentsCsv(csv);
  const issued = students.map((s, i) => credential.issueCredential(s, i));
  const tree = merkle.buildMerkleTree(issued.map((e) => e.leaf));
  const root = toHex(tree.root);

  const publishResponse = await fetch("/api/chain/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      root,
      semesterId: "2027-SPRING",
      leafCount: tree.leafCount,
      depth: tree.depth,
    }),
  });
  ok(publishResponse.ok, "POST /api/chain/publish accepted the root");

  function bundleFor(roll) {
    const entry = issued.find((e) => e.rollNumber === roll);
    const p = merkle.getMerkleProof(tree, entry.leafIndex);
    return credential.parseBundle(
      credential.buildBundle({
        issued: entry,
        semesterId: "2027-SPRING",
        root,
        depth: tree.depth,
        leafCount: tree.leafCount,
        pathElements: p.pathElements,
        pathIndices: p.pathIndices,
      }),
    );
  }

  const request = {
    requestId: "req-http",
    verifierName: "Acme Systems (hiring)",
    threshold: 800,
    requiredDegreeCode: 1101,
    minYear: 2023,
    maxYear: 2027,
    nonce: credential.randomNonce(),
    issuedAt: new Date().toISOString(),
  };

  section("Prove and verify over the live chain");
  const aarav = bundleFor("BTECH/27431/23");
  const proof = await prover.generateProof(aarav, request);
  ok(Boolean(proof.pi_a), "generateProof produced a proof against the live chain");
  ok(
    (await prover.verifyProof(proof, root, request)) === true,
    "verifyProof returns TRUE over HTTP",
  );

  section("Soundness over the live chain");
  let low = null;
  try {
    await prover.generateProof(bundleFor("BTECH/27155/23"), request);
  } catch (err) {
    low = err;
  }
  ok(low && low.constraint === "cgpa", "CGPA 6.40 still cannot prove CGPA >= 8.00");

  section("Revocation over the live chain");
  const revokeResponse = await fetch("/api/chain/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaf: aarav.merkle.leaf,
      root,
      semesterId: "2027-SPRING",
      reason: "Revoked by registrar (integration check)",
    }),
  });
  ok(revokeResponse.ok, "POST /api/chain/revoke accepted the leaf");

  const after = await prover.verifyProofDetailed(proof, root, request);
  ok(after.valid === false, "the same proof now verifies FALSE");
  ok(
    after.checks.find((c) => c.id === "revocation").ok === false,
    "and it fails at the revocation check",
  );

  let regen = null;
  try {
    await prover.generateProof(aarav, request);
  } catch (err) {
    regen = err;
  }
  ok(
    regen && regen.constraint === "revocation",
    "the revoked holder cannot make a fresh proof either",
  );

  /* ---------------------------------------------------------------- */

  section("Network audit — what actually crossed the wire");
  console.log("  " + wire.length + " requests recorded:");
  for (const entry of wire) {
    console.log(
      "    " +
        entry.method +
        " " +
        entry.url.replace(BASE, "") +
        (entry.body ? " body=" + entry.body : ""),
    );
  }

  const allBodies = wire.map((w) => w.body || "").join("\n");

  const forbidden = [
    ["a CGPA value", String(aarav.credential.cgpaInt)],
    ["the student's name", aarav.credential.name],
    ["the roll number", aarav.credential.rollNumber],
    ["the blinding factor r", aarav.secrets.r],
    ["the identity secret", aarav.secrets.identitySecret],
    ["the identity commitment", aarav.credential.identityCommitment],
  ];

  for (const [label, needle] of forbidden) {
    ok(
      !allBodies.includes(needle),
      "no request body contains " + label,
      "found in: " + allBodies.slice(0, 200),
    );
  }

  // The leaf is the one commitment that legitimately goes on chain, and only
  // when the issuer revokes. Confirm it appears nowhere else.
  const leafRequests = wire.filter(
    (w) => w.body && w.body.includes(aarav.merkle.leaf),
  );
  ok(
    leafRequests.length === 1 && leafRequests[0].url.endsWith("/api/chain/revoke"),
    "the leaf hash appears only in the revocation request",
    leafRequests.map((r) => r.url).join(", "),
  );

  ok(
    wire.every(
      (w) =>
        w.method === "GET" ||
        w.url.endsWith("/api/chain/publish") ||
        w.url.endsWith("/api/chain/revoke"),
    ),
    "the only writes are publish and revoke",
  );

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
  console.error("\nIs the dev server running on " + BASE + " ?\n", err);
  process.exit(1);
});
