const assert = require("assert");
const { makeCircuit } = require("./stark-benchmark.cjs");

function prove(circuit) {
  return circuit.stark.prove(circuit.assertions, circuit.testCase.inputs);
}

function mustReject(label, action) {
  let rejected = false;
  try {
    rejected = action() === false;
  } catch {
    rejected = true;
  }
  assert(rejected, `${label}: invalid statement was accepted`);
  console.log(`  ok ${label}`);
}

console.log("STARK soundness checks");

const cp = makeCircuit("CP", 13);
const cpProof = prove(cp);
assert(cp.stark.verify(cp.assertions, cpProof, cp.testCase.publicInputs));
console.log("  ok CP proof verifies");
mustReject("stronger threshold changes the public statement", () =>
  cp.stark.verify(cp.assertions, cpProof, [[900n], [BigInt(cp.testCase.requiredType)]]),
);

const badBits = makeCircuit("CP", 13);
badBits.testCase.inputs[6] = [1n - badBits.testCase.inputs[6][0]];
mustReject("tampered range decomposition", () => prove(badBits));

const mcm = makeCircuit("MCM", 4);
const badPath = makeCircuit("MCM", 4);
badPath.testCase.inputs[26][0][1] += 1n;
mustReject("tampered issuance path", () => prove(badPath));
const mcmProof = prove(mcm);
assert(mcm.stark.verify(mcm.assertions, mcmProof, mcm.testCase.publicInputs));
console.log("  ok MCM private membership path verifies");

const ibrr = makeCircuit("IBRR", 4);
const ibrrProof = prove(ibrr);
const wrongNonceInputs = ibrr.testCase.publicInputs.map((value) => value.slice());
wrongNonceInputs[2][0] += 1n;
mustReject("cross-session nonce", () =>
  ibrr.stark.verify(ibrr.assertions, ibrrProof, wrongNonceInputs),
);

const ra = makeCircuit("RA", 4);
const badValidity = makeCircuit("RA", 4);
badValidity.testCase.inputs[30][0][1] += 1n;
mustReject("tampered validity path", () => prove(badValidity));
const raProof = prove(ra);
assert(ra.stark.verify(ra.assertions, raProof, ra.testCase.publicInputs));
console.log("  ok RA issuance and validity paths verify");

console.log("All STARK soundness checks passed.");
