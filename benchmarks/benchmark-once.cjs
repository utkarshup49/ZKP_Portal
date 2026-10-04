const { makeCircuit, runOnce } = require("./stark-benchmark.cjs");

const [variant, depthText, phase, runText, warmupsText] = process.argv.slice(2);
const depth = Number(depthText);
const run = Number(runText);
const warmups = Number(warmupsText || 1);
const circuit = makeCircuit(variant, depth);

for (let i = 0; i < warmups; i += 1) {
  runOnce(circuit, i + 1, "warmup");
}

const result = runOnce(circuit, run, phase);
process.stdout.write(`RESULT_JSON ${JSON.stringify(result)}\n`);
