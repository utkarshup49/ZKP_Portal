const { parentPort, workerData } = require("worker_threads");
const { performance } = require("perf_hooks");
const { makeCircuit } = require("./stark-benchmark.cjs");

const circuit = makeCircuit(workerData.variant, workerData.depth);
const proof = circuit.stark.parse(Buffer.from(workerData.proofBase64, "base64"));

parentPort.on("message", (message) => {
  const startedAt = performance.now();
  const valid = circuit.stark.verify(
    circuit.assertions,
    proof,
    circuit.testCase.publicInputs,
  );
  parentPort.postMessage({
    type: "result",
    id: message.id,
    valid,
    serviceMs: performance.now() - startedAt,
  });
});

parentPort.postMessage({ type: "ready" });
