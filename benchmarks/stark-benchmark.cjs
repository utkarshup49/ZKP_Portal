/*
 * Reproducible STARK benchmark for the staged credential design in main-2.pdf.
 *
 * This is intentionally separate from lib/prover.ts: the application still has
 * a Groth16-shaped demo stub, while this harness instantiates real FRI proofs
 * using genSTARK. Run `npm run benchmark:stark` from the repository root.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { Worker } = require("worker_threads");
const { spawnSync } = require("child_process");
const {
  createPrimeField,
  instantiateScript,
} = require("@guildofweavers/genstark");

const ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(__dirname, "results");
const FIELD_MODULUS = 2n ** 128n - 9n * 2n ** 32n + 1n;
const field = createPrimeField(FIELD_MODULUS);
const ROUND_STEPS = 64;
const FULL_ROUNDS = 8;
const PARTIAL_ROUNDS = 55;
const STATE_WIDTH = 6;
const DEFAULT_DEPTH = 13;
const DEPTHS = [4, 8, 10, 13, 16, 20];
const VARIANTS = ["CP", "MCM", "IBRR", "RA"];
const ALL_CONFIGS = ["COMMIT", ...VARIANTS];
const DOMAIN_NULLIFIER = field.add(
  BigInt("0x" + crypto.createHash("sha256").update("zk-credentials/v1/nullifier").digest("hex")),
  0n,
);

const OPTIONS = {
  hashAlgorithm: "blake2s256",
  extensionFactor: 32,
  exeQueryCount: 44,
  friQueryCount: 20,
  wasm: true,
};

const silentLogger = {
  start: () => () => {},
  sub: () => () => {},
  done: () => {},
};

function parseArgs(argv) {
  const result = {
    mode: "full",
    repetitions: 30,
    scalingRepetitions: 3,
    warmups: 1,
    concurrency: 8,
    cdfRequests: 280,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--smoke") {
      result.mode = "smoke";
      result.repetitions = 1;
      result.scalingRepetitions = 1;
      result.warmups = 0;
      result.cdfRequests = 12;
      result.concurrency = 2;
    } else if (arg === "--quick") {
      result.mode = "quick";
      result.repetitions = 5;
      result.scalingRepetitions = 1;
      result.warmups = 1;
      result.cdfRequests = 60;
      result.concurrency = 4;
    } else if (arg.startsWith("--repetitions=")) {
      result.repetitions = Number(arg.split("=")[1]);
    } else if (arg.startsWith("--scaling-repetitions=")) {
      result.scalingRepetitions = Number(arg.split("=")[1]);
    } else if (arg.startsWith("--warmups=")) {
      result.warmups = Number(arg.split("=")[1]);
    } else if (arg === "--skip-cdf") {
      result.cdfRequests = 0;
    }
  }
  return result;
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function traceShape(variant, depth) {
  if (variant === "COMMIT" || variant === "CP") {
    return { blocks: 1, traceLength: ROUND_STEPS, paddedPathDepth: 0 };
  }
  const blocks = nextPowerOfTwo(depth + 1);
  return {
    blocks,
    traceLength: blocks * ROUND_STEPS,
    paddedPathDepth: blocks - 1,
  };
}

function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

function getConstants(seed, count) {
  return Array.from({ length: count }, (_, i) =>
    field.add(
      BigInt("0x" + crypto.createHash("sha256").update(`${seed}${i}`).digest("hex")),
      0n,
    ),
  );
}

function getMdsMatrix(width) {
  const x = getConstants("HadesMDSx", width);
  const y = getConstants("HadesMDSy", width);
  return x.map((xValue) => y.map((yValue) => field.inv(field.sub(xValue, yValue))));
}

function getRoundConstants(width, rounds) {
  return Array.from({ length: rounds }, (_, round) =>
    Array.from({ length: width }, (_, column) => {
      const i = round * width + column;
      return field.add(
        BigInt("0x" + crypto.createHash("sha256").update(`Hades${i}`).digest("hex")),
        0n,
      );
    }),
  );
}

const MDS = getMdsMatrix(STATE_WIDTH);
const ROUND_CONSTANTS = transpose(
  getRoundConstants(STATE_WIDTH, FULL_ROUNDS + PARTIAL_ROUNDS + 1),
);

function poseidon(inputs) {
  if (inputs.length < 1 || inputs.length >= STATE_WIDTH) {
    throw new Error(`Poseidon expects 1-${STATE_WIDTH - 1} inputs`);
  }
  let values = [...inputs];
  while (values.length < STATE_WIDTH) values.push(0n);
  let state = field.newVectorFrom(values);
  const mds = field.newMatrixFrom(MDS);
  const ark = transpose(ROUND_CONSTANTS).map((row) => field.newVectorFrom(row));
  for (let i = 0; i < FULL_ROUNDS + PARTIAL_ROUNDS; i += 1) {
    state = field.addVectorElements(state, ark[i]);
    if (i < FULL_ROUNDS / 2 || i >= FULL_ROUNDS / 2 + PARTIAL_ROUNDS) {
      state = field.expVectorElements(state, 5n);
    } else {
      const next = state.toValues();
      next[STATE_WIDTH - 1] = field.exp(next[STATE_WIDTH - 1], 5n);
      state = field.newVectorFrom(next);
    }
    state = field.mulMatrixByVector(mds, state);
  }
  return state.toValues().slice(0, 2);
}

function inlineVector(values) {
  return `[${values.map(String).join(", ")}]`;
}

function inlineMatrix(matrix) {
  return `[${matrix.map(inlineVector).join(", ")}]`;
}

function bitsOf(value, count = 10) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** count) {
    throw new Error(`${value} does not fit in ${count} bits`);
  }
  return Array.from({ length: count }, (_, i) => BigInt((value >> i) & 1));
}

function deterministicField(label) {
  return field.add(
    BigInt("0x" + crypto.createHash("sha256").update(label).digest("hex")),
    0n,
  );
}

function csvRows() {
  const text = fs.readFileSync(path.join(ROOT, "data", "sample-students.csv"), "utf8").trim();
  const contentLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const [header, ...lines] = contentLines;
  const names = header.split(",").map((value) => value.trim());
  return lines.map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
  });
}

function sampleCredential() {
  const rows = csvRows();
  const row = rows.find((item) => item.rollNumber === "BTECH/27431/23") || rows[0];
  const cgpaInt = Math.round(Number(row.cgpa) * 100);
  const degreeCode = Number(row.degreeCode);
  const identitySecret = deterministicField(`identity:${row.rollNumber}`);
  const metaDigest = deterministicField(
    `meta:${row.rollNumber}:${row.year}:BITM:benchmark-blinding-factor`,
  );
  return {
    row,
    cgpaInt,
    degreeCode,
    identitySecret,
    metaDigest,
    commitment: poseidon([identitySecret, BigInt(cgpaInt), BigInt(degreeCode), metaDigest]),
  };
}

function pathFor(leaf, depth, label) {
  let current = leaf;
  const nodes = [];
  const bits = [];
  for (let level = 0; level < depth; level += 1) {
    const sibling = [
      deterministicField(`${label}:sibling:${level}:0`),
      deterministicField(`${label}:sibling:${level}:1`),
    ];
    const bit = BigInt(level % 3 === 1 ? 1 : 0);
    nodes.push(sibling);
    bits.push(bit);
    current = bit === 1n
      ? poseidon([...sibling, ...current])
      : poseidon([...current, ...sibling]);
  }
  return { nodes, bits, root: current };
}

function padPath(pathData, paddedDepth, label) {
  const nodes = pathData.nodes.slice();
  const bits = pathData.bits.slice();
  while (nodes.length < paddedDepth) {
    const level = nodes.length;
    nodes.push([
      deterministicField(`${label}:trace-padding:${level}:0`),
      deterministicField(`${label}:trace-padding:${level}:1`),
    ]);
    bits.push(0n);
  }
  return { nodes, bits };
}

function declarations(variant) {
  const lines = [
    "secret input identitySecret: element[1];",
    "secret input cgpa: element[1];",
    "secret input credentialType: element[1];",
    "secret input metadata: element[1];",
  ];
  if (variant !== "COMMIT") {
    lines.push("public input threshold: element[1];");
    lines.push("public input requiredType: element[1];");
    lines.push("secret input rangeBits: boolean[20];");
  }
  if (["IBRR", "RA"].includes(variant)) {
    lines.push("public input nonce: element[1];");
  }
  if (["MCM", "IBRR", "RA"].includes(variant)) {
    lines.push("secret input issuanceNode: element[2][1];");
    lines.push("secret input issuanceBit: boolean[1][1];");
  }
  if (variant === "RA") {
    lines.push("secret input validityNode: element[2][1];");
    lines.push("secret input validityBit: boolean[1][1];");
  }
  return lines.join("\n        ");
}

function inputNames(variant) {
  const names = ["identitySecret", "cgpa", "credentialType", "metadata"];
  if (variant !== "COMMIT") {
    names.push("threshold", "requiredType");
    names.push("rangeBits");
  }
  if (["IBRR", "RA"].includes(variant)) names.push("nonce");
  if (["MCM", "IBRR", "RA"].includes(variant)) {
    names.push("issuanceNode", "issuanceBit");
  }
  if (variant === "RA") names.push("validityNode", "validityBit");
  return names.join(", ");
}

function poseidonRounds(offset, totalWidth, freezeFrom, traceLength) {
  const current = `$r[${offset}..${offset + 5}]`;
  const full = `
            for steps [1..4, 60..63] {
                S <- mds # (${current} + roundConstants)^5;
                yield ${embed(totalWidth, offset, 6, "S")};
            }`;
  const partial = `
            for steps [5..59] {
                v <- ($r${offset + 5} + roundConstants[5])^5;
                S <- mds # [...($r[${offset}..${offset + 4}] + roundConstants[0..4]), v];
                yield ${embed(totalWidth, offset, 6, "S")};
            }`;
  const freeze = freezeFrom < traceLength
    ? `\n            for steps [${freezeFrom}..${traceLength - 1}] { yield $r; }`
    : "";
  return full + partial + freeze;
}

function embed(totalWidth, offset, width, expression) {
  if (offset === 0 && width === totalWidth) return expression;
  const values = [];
  if (offset > 0) values.push(`...$r[0..${offset - 1}]`);
  values.push(`...${expression}`);
  if (offset + width < totalWidth) values.push(`...$r[${offset + width}..${totalWidth - 1}]`);
  return `[${values.join(", ")}]`;
}

function commitmentMerkleDomain(offset, totalWidth, nodeName, bitName) {
  return `
        with $r[${offset}..${offset + 11}] {
            init { yield [identitySecret, cgpa, credentialType, metadata, 0, 0, 0, 0, 0, 0, 0, 0]; }

            for steps [1..4, 60..63] {
                S <- mds # ($r[${offset}..${offset + 5}] + roundConstants)^5;
                yield [...S, 0, 0, 0, 0, 0, 0];
            }
            for steps [5..59] {
                v <- ($r${offset + 5} + roundConstants[5])^5;
                S <- mds # [...($r[${offset}..${offset + 4}] + roundConstants[0..4]), v];
                yield [...S, 0, 0, 0, 0, 0, 0];
            }

            for each (${nodeName}, ${bitName}) {
                init {
                    H <- $r[${offset}..${offset + 1}];
                    S1 <- [...H, ...${nodeName}, 0, 0];
                    S2 <- [...${nodeName}, ...H, 0, 0];
                    yield [...S1, ...S2];
                }
                for steps [1..4, 60..63] {
                    S1 <- mds # ($r[${offset}..${offset + 5}] + roundConstants)^5;
                    S2 <- mds # ($r[${offset + 6}..${offset + 11}] + roundConstants)^5;
                    yield [...S1, ...S2];
                }
                for steps [5..59] {
                    v1 <- ($r${offset + 5} + roundConstants[5])^5;
                    S1 <- mds # [...($r[${offset}..${offset + 4}] + roundConstants[0..4]), v1];
                    v2 <- ($r${offset + 11} + roundConstants[5])^5;
                    S2 <- mds # [...($r[${offset + 6}..${offset + 10}] + roundConstants[0..4]), v2];
                    yield [...S1, ...S2];
                }
            }
        }`;
}

function buildAirScript(variant, depth) {
  const shape = traceShape(variant, depth);
  const hasIssuance = ["MCM", "IBRR", "RA"].includes(variant);
  const hasPredicate = variant !== "COMMIT";
  const hasNullifier = ["IBRR", "RA"].includes(variant);
  let width = 6;
  const predicateOffset = hasPredicate ? width : -1;
  if (hasPredicate) width += 5;
  const nullifierOffset = hasNullifier ? width : -1;
  if (hasNullifier) width += 6;
  const validityOffset = variant === "RA" ? width : -1;
  if (variant === "RA") width += 6;

  const attrSum = Array.from({ length: 10 }, (_, i) => `rangeBits[${i}] * ${2 ** i}`).join(" + ");
  const diffSum = Array.from({ length: 10 }, (_, i) => `rangeBits[${i + 10}] * ${2 ** i}`).join(" + ");

  const initParts = ["identitySecret", "cgpa", "credentialType", "metadata", "0", "0"];
  if (hasPredicate) {
    initParts.push(
      `cgpa - (${attrSum})`,
      `cgpa - threshold - (${diffSum})`,
      "credentialType - requiredType",
      "0",
      "0",
    );
  }
  if (hasNullifier) {
    initParts.push("identitySecret", "nonce", String(DOMAIN_NULLIFIER), "0", "0", "0");
  }
  if (variant === "RA") {
    initParts.push("identitySecret", "cgpa", "credentialType", "metadata", "0", "0");
  }

  function stateParts(kind) {
    const parts = [];
    if (kind === "full") {
      parts.push("...mainFull");
    } else {
      parts.push("...mainPartial");
    }
    if (hasPredicate) parts.push(`...$r[${predicateOffset}..${predicateOffset + 4}]`);
    if (hasNullifier) parts.push(kind === "full" ? "...nullFull" : "...nullPartial");
    if (variant === "RA") parts.push(kind === "full" ? "...validFull" : "...validPartial");
    return `[${parts.join(", ")}]`;
  }

  const initialFullLocals = ["mainFull <- mds # ($r[0..5] + roundConstants)^5;"];
  const initialPartialLocals = [
    "mainV <- ($r5 + roundConstants[5])^5;",
    "mainPartial <- mds # [...($r[0..4] + roundConstants[0..4]), mainV];",
  ];
  if (hasNullifier) {
    initialFullLocals.push(`nullFull <- mds # ($r[${nullifierOffset}..${nullifierOffset + 5}] + roundConstants)^5;`);
    initialPartialLocals.push(
      `nullV <- ($r${nullifierOffset + 5} + roundConstants[5])^5;`,
      `nullPartial <- mds # [...($r[${nullifierOffset}..${nullifierOffset + 4}] + roundConstants[0..4]), nullV];`,
    );
  }
  if (variant === "RA") {
    initialFullLocals.push(`validFull <- mds # ($r[${validityOffset}..${validityOffset + 5}] + roundConstants)^5;`);
    initialPartialLocals.push(
      `validV <- ($r${validityOffset + 5} + roundConstants[5])^5;`,
      `validPartial <- mds # [...($r[${validityOffset}..${validityOffset + 4}] + roundConstants[0..4]), validV];`,
    );
  }

  let nested = "";
  if (hasIssuance) {
    const nestedNames = variant === "RA"
      ? "issuanceNode, issuanceBit, validityNode, validityBit"
      : "issuanceNode, issuanceBit";
    const nestedInitParts = [
      "...mainState",
    ];
    if (hasPredicate) nestedInitParts.push(`...$r[${predicateOffset}..${predicateOffset + 4}]`);
    if (hasNullifier) nestedInitParts.push(`...$r[${nullifierOffset}..${nullifierOffset + 5}]`);
    if (variant === "RA") nestedInitParts.push("...validState");

    const nestedFullParts = ["...mainFull"];
    if (hasPredicate) nestedFullParts.push(`...$r[${predicateOffset}..${predicateOffset + 4}]`);
    if (hasNullifier) nestedFullParts.push("...nullFull");
    if (variant === "RA") nestedFullParts.push("...validFull");

    const nestedPartialParts = ["...mainPartial"];
    if (hasPredicate) nestedPartialParts.push(`...$r[${predicateOffset}..${predicateOffset + 4}]`);
    if (hasNullifier) nestedPartialParts.push("...nullPartial");
    if (variant === "RA") nestedPartialParts.push("...validPartial");

    nested = `
            for each (${nestedNames}) {
                init {
                    mainState <- issuanceBit ? [...issuanceNode, ...$r[0..1], 0, 0] : [...$r[0..1], ...issuanceNode, 0, 0];
                    ${variant === "RA" ? `validState <- validityBit ? [...validityNode, ...$r[${validityOffset}..${validityOffset + 1}], 0, 0] : [...$r[${validityOffset}..${validityOffset + 1}], ...validityNode, 0, 0];` : ""}
                    yield [${nestedInitParts.join(", ")}];
                }
                for steps [1..4, 60..63] {
                    mainFull <- mds # ($r[0..5] + roundConstants)^5;
                    ${hasNullifier ? `nullFull <- mds # ($r[${nullifierOffset}..${nullifierOffset + 5}] + roundConstants)^5;` : ""}
                    ${variant === "RA" ? `validFull <- mds # ($r[${validityOffset}..${validityOffset + 5}] + roundConstants)^5;` : ""}
                    yield [${nestedFullParts.join(", ")}];
                }
                for steps [5..59] {
                    mainV <- ($r5 + roundConstants[5])^5;
                    mainPartial <- mds # [...($r[0..4] + roundConstants[0..4]), mainV];
                    ${hasNullifier ? `nullV <- ($r${nullifierOffset + 5} + roundConstants[5])^5;
                    nullPartial <- mds # [...($r[${nullifierOffset}..${nullifierOffset + 4}] + roundConstants[0..4]), nullV];` : ""}
                    ${variant === "RA" ? `validV <- ($r${validityOffset + 5} + roundConstants[5])^5;
                    validPartial <- mds # [...($r[${validityOffset}..${validityOffset + 4}] + roundConstants[0..4]), validV];` : ""}
                    yield [${nestedPartialParts.join(", ")}];
                }
            }`;
  }

  const roundSection = hasIssuance
    ? nested
    : `
            for steps [1..4, 60..63] {
                ${initialFullLocals.join("\n                ")}
                yield ${stateParts("full")};
            }
            for steps [5..59] {
                ${initialPartialLocals.join("\n                ")}
                yield ${stateParts("partial")};
            }`;

  const source = `
define Credential${variant}D${depth} over prime field (${FIELD_MODULUS}) {
    const mds: ${inlineMatrix(MDS)};
    static roundConstants: [
        ${ROUND_CONSTANTS.map((values) => `cycle ${inlineVector(values)}`).join(",\n        ")}
    ];

    ${declarations(variant)}

    transition ${width} registers {
        for each (${inputNames(variant)}) {
            init { yield [${initParts.join(", ")}]; }
            ${roundSection}
        }
    }

    enforce ${width} constraints {
        for all steps { enforce transition($r) = $n; }
    }
}`;

  return { source, width, ...shape, predicateOffset, nullifierOffset, validityOffset };
}

function buildCase(variant, depth) {
  const credential = sampleCredential();
  const threshold = 800;
  const requiredType = credential.degreeCode;
  const nonce = deterministicField("benchmark-session-nonce");
  const shape = traceShape(variant, depth);
  const issuePath = pathFor(credential.commitment, depth, `issuance:d${depth}`);
  const validityLeaf = credential.commitment;
  const validityPath = pathFor(validityLeaf, depth, `validity:d${depth}`);
  const paddedIssue = padPath(issuePath, shape.paddedPathDepth, `issuance:d${depth}`);
  const paddedValidity = padPath(validityPath, shape.paddedPathDepth, `validity:d${depth}`);
  const nullifier = poseidon([credential.identitySecret, nonce, DOMAIN_NULLIFIER]);

  const inputs = [
    [credential.identitySecret],
    [BigInt(credential.cgpaInt)],
    [BigInt(credential.degreeCode)],
    [credential.metaDigest],
  ];
  const publicInputs = [];
  if (variant !== "COMMIT") {
    inputs.push([BigInt(threshold)], [BigInt(requiredType)]);
    publicInputs.push([BigInt(threshold)], [BigInt(requiredType)]);
    for (const bit of bitsOf(credential.cgpaInt)) inputs.push([bit]);
    for (const bit of bitsOf(credential.cgpaInt - threshold)) inputs.push([bit]);
  }
  if (["IBRR", "RA"].includes(variant)) {
    inputs.push([nonce]);
    publicInputs.push([nonce]);
  }
  if (["MCM", "IBRR", "RA"].includes(variant)) {
    const dummy = [deterministicField("outer:dummy:0"), deterministicField("outer:dummy:1")];
    const nodes = [dummy, ...paddedIssue.nodes];
    const bits = [0n, ...paddedIssue.bits];
    inputs.push([nodes.map((node) => node[0])], [nodes.map((node) => node[1])], [bits]);
  }
  if (variant === "RA") {
    const dummy = [deterministicField("validity:outer:dummy:0"), deterministicField("validity:outer:dummy:1")];
    const nodes = [dummy, ...paddedValidity.nodes];
    const bits = [0n, ...paddedValidity.bits];
    inputs.push([nodes.map((node) => node[0])], [nodes.map((node) => node[1])], [bits]);
  }

  return {
    credential,
    threshold,
    requiredType,
    nonce,
    nullifier,
    issuePath,
    validityPath,
    inputs,
    publicInputs,
  };
}

function makeCircuit(variant, depth) {
  const air = buildAirScript(variant, depth);
  const stark = instantiateScript(Buffer.from(air.source), OPTIONS, silentLogger);
  const testCase = buildCase(variant, depth);
  const assertions = [];
  if (variant === "COMMIT" || variant === "CP") {
    assertions.push({ step: 63, register: 0, value: testCase.credential.commitment[0] });
    assertions.push({ step: 63, register: 1, value: testCase.credential.commitment[1] });
  } else {
    const rootStep = ROUND_STEPS * (depth + 1) - 1;
    assertions.push({ step: rootStep, register: 0, value: testCase.issuePath.root[0] });
    assertions.push({ step: rootStep, register: 1, value: testCase.issuePath.root[1] });
  }
  if (variant !== "COMMIT") {
    assertions.push({ step: air.traceLength - 1, register: air.predicateOffset, value: 0n });
    assertions.push({ step: air.traceLength - 1, register: air.predicateOffset + 1, value: 0n });
    assertions.push({ step: air.traceLength - 1, register: air.predicateOffset + 2, value: 0n });
  }
  if (["IBRR", "RA"].includes(variant)) {
    assertions.push({ step: 63, register: air.nullifierOffset, value: testCase.nullifier[0] });
    assertions.push({ step: 63, register: air.nullifierOffset + 1, value: testCase.nullifier[1] });
  }
  if (variant === "RA") {
    const rootStep = ROUND_STEPS * (depth + 1) - 1;
    assertions.push({ step: rootStep, register: air.validityOffset, value: testCase.validityPath.root[0] });
    assertions.push({ step: rootStep, register: air.validityOffset + 1, value: testCase.validityPath.root[1] });
  }
  return { variant, depth, air, stark, testCase, assertions };
}

function runOnce(circuit, run, phase) {
  if (global.gc) global.gc();
  const rssBefore = process.memoryUsage().rss;
  const proveStart = performance.now();
  const proof = circuit.stark.prove(circuit.assertions, circuit.testCase.inputs);
  const proveMs = performance.now() - proveStart;
  const rssAfter = process.memoryUsage().rss;
  const verifyStart = performance.now();
  const valid = circuit.stark.verify(
    circuit.assertions,
    proof,
    circuit.testCase.publicInputs,
  );
  const verifyMs = performance.now() - verifyStart;
  if (!valid) throw new Error(`${circuit.variant} depth ${circuit.depth}: proof rejected`);
  return {
    phase,
    variant: circuit.variant,
    depth: circuit.depth,
    run,
    prover_ms: proveMs,
    verifier_ms: verifyMs,
    proof_bytes: circuit.stark.sizeOf(proof),
    rss_before_bytes: rssBefore,
    rss_after_bytes: rssAfter,
    rss_delta_bytes: Math.max(0, rssAfter - rssBefore),
    trace_length: circuit.air.traceLength,
    trace_width: circuit.air.width,
    trace_cells: circuit.air.traceLength * circuit.air.width,
    constraint_count: circuit.stark.air.constraints.length,
    max_constraint_degree: circuit.stark.air.maxConstraintDegree,
    security_bits: circuit.stark.securityLevel,
    valid,
  };
}

function runIsolated(variant, depth, run, phase, warmups) {
  const child = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      path.join(__dirname, "benchmark-once.cjs"),
      variant,
      String(depth),
      phase,
      String(run),
      String(warmups),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (child.status !== 0) {
    throw new Error(
      `isolated ${variant} d=${depth} run=${run} failed:\n${child.stderr || child.stdout}`,
    );
  }
  const resultLine = child.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESULT_JSON "));
  if (!resultLine) throw new Error(`isolated ${variant} run emitted no result`);
  return JSON.parse(resultLine.slice("RESULT_JSON ".length));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.phase}|${row.variant}|${row.depth}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.values()).map((items) => {
    const first = items[0];
    const numeric = (key) => items.map((item) => item[key]);
    return {
      phase: first.phase,
      variant: first.variant,
      depth: first.depth,
      n: items.length,
      prover_median_ms: median(numeric("prover_ms")),
      prover_mean_ms: numeric("prover_ms").reduce((a, b) => a + b, 0) / items.length,
      verifier_median_ms: median(numeric("verifier_ms")),
      proof_bytes: first.proof_bytes,
      rss_delta_peak_bytes: Math.max(...numeric("rss_delta_bytes")),
      rss_after_peak_bytes: Math.max(...numeric("rss_after_bytes")),
      trace_length: first.trace_length,
      trace_width: first.trace_width,
      trace_cells: first.trace_cells,
      constraint_count: first.constraint_count,
      max_constraint_degree: first.max_constraint_degree,
      security_bits: first.security_bits,
    };
  });
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(",")];
  for (const row of rows) lines.push(keys.map((key) => csvEscape(row[key])).join(","));
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function hardwareMetadata(args) {
  const cpus = os.cpus();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return {
    generated_at: new Date().toISOString(),
    command_mode: args.mode,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0] ? cpus[0].model.trim() : "unknown",
    logical_cores: cpus.length,
    total_ram_bytes: os.totalmem(),
    node: process.version,
    genstark: pkg.devDependencies["@guildofweavers/genstark"],
    field: `2^128 - 9*2^32 + 1`,
    hash: "Poseidon t=6, alpha=5, 8 full + 55 partial rounds",
    stark_options: OPTIONS,
    repetitions: args.repetitions,
    scaling_repetitions: args.scalingRepetitions,
    warmups: args.warmups,
    cdf_requests: args.cdfRequests,
    cdf_concurrency: args.concurrency,
    dataset: "data/sample-students.csv; BTECH/27431/23; CGPA 8.34",
    backend_note:
      "Real FRI STARK proofs. The benchmark field/hash parameterization is genSTARK's optimized 128-bit Poseidon example, not the application's BN254 poseidon-lite instance.",
  };
}

async function runConcurrentVerification(args) {
  if (args.cdfRequests <= 0) return [];
  log(`prepare concurrent verification proof (${args.cdfRequests} requests, pool=${args.concurrency})`);
  const circuit = makeCircuit("RA", DEFAULT_DEPTH);
  const proof = circuit.stark.prove(circuit.assertions, circuit.testCase.inputs);
  const proofBase64 = circuit.stark.serialize(proof).toString("base64");
  const workerPath = path.join(__dirname, "verify-worker.cjs");
  const workerCount = Math.min(args.concurrency, args.cdfRequests);
  const workers = [];

  await Promise.all(
    Array.from({ length: workerCount }, (_, workerIndex) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, {
          workerData: { variant: "RA", depth: DEFAULT_DEPTH, proofBase64, workerIndex },
        });
        worker.once("error", reject);
        worker.once("message", (message) => {
          if (message.type !== "ready") {
            reject(new Error(`verification worker ${workerIndex} failed to initialize`));
            return;
          }
          workers.push(worker);
          resolve();
        });
      }),
    ),
  );

  const rows = [];
  const startedAt = performance.now();
  let nextRequest = 0;
  let completed = 0;
  await new Promise((resolve, reject) => {
    const dispatch = (worker) => {
      if (nextRequest >= args.cdfRequests) return;
      const id = nextRequest;
      nextRequest += 1;
      worker.postMessage({ id });
    };
    for (const worker of workers) {
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (message.type !== "result") return;
        const now = performance.now();
        rows.push({
          request_id: message.id,
          concurrency: workerCount,
          latency_ms: now - startedAt,
          service_ms: message.serviceMs,
          valid: message.valid,
        });
        completed += 1;
        if (!message.valid) {
          reject(new Error(`concurrent verification request ${message.id} failed`));
          return;
        }
        if (completed === args.cdfRequests) resolve();
        else dispatch(worker);
      });
      dispatch(worker);
    }
  });

  await Promise.all(workers.map((worker) => worker.terminate()));
  rows.sort((a, b) => a.request_id - b.request_id);
  log(`concurrent verification complete in ${(performance.now() - startedAt).toFixed(1)} ms`);
  return rows;
}

function log(message) {
  process.stdout.write(`[benchmark] ${message}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const rows = [];

  log(`mode=${args.mode}; default-depth repetitions=${args.repetitions}`);
  for (const variant of ALL_CONFIGS) {
    for (let i = 0; i < args.repetitions; i += 1) {
      log(`measure ${variant} ${i + 1}/${args.repetitions}`);
      rows.push(runIsolated(variant, DEFAULT_DEPTH, i + 1, "variants", args.warmups));
      fs.writeFileSync(path.join(RESULTS_DIR, "raw-runs.partial.json"), JSON.stringify(rows, null, 2) + "\n");
    }
  }

  const scalingDepths = args.mode === "smoke" ? [4] : DEPTHS;
  for (const depth of scalingDepths) {
    for (const variant of ["MCM", "IBRR", "RA"]) {
      if (depth === DEFAULT_DEPTH) continue;
      for (let i = 0; i < args.scalingRepetitions; i += 1) {
        log(`scale ${variant} d=${depth} ${i + 1}/${args.scalingRepetitions}`);
        rows.push(runIsolated(variant, depth, i + 1, "scaling", args.warmups));
        fs.writeFileSync(path.join(RESULTS_DIR, "raw-runs.partial.json"), JSON.stringify(rows, null, 2) + "\n");
      }
    }
  }

  const summaries = summarize(rows.filter((row) => row.phase !== "warmup"));
  const cdfRows = await runConcurrentVerification(args);
  const metadata = hardwareMetadata(args);
  fs.writeFileSync(path.join(RESULTS_DIR, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "raw-runs.json"), JSON.stringify(rows, null, 2) + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "summary.json"), JSON.stringify(summaries, null, 2) + "\n");
  writeCsv(path.join(RESULTS_DIR, "raw-runs.csv"), rows);
  writeCsv(path.join(RESULTS_DIR, "summary.csv"), summaries);
  fs.writeFileSync(path.join(RESULTS_DIR, "verification-cdf.json"), JSON.stringify(cdfRows, null, 2) + "\n");
  writeCsv(path.join(RESULTS_DIR, "verification-cdf.csv"), cdfRows);
  fs.rmSync(path.join(RESULTS_DIR, "raw-runs.partial.json"), { force: true });

  log(`wrote ${rows.length} measured rows to ${path.relative(ROOT, RESULTS_DIR)}`);
  const defaultSummary = summaries.filter((item) => item.phase === "variants");
  for (const item of defaultSummary) {
    log(
      `${item.variant}: prove=${item.prover_median_ms.toFixed(1)} ms, ` +
        `verify=${item.verifier_median_ms.toFixed(1)} ms, ` +
        `proof=${(item.proof_bytes / 1024).toFixed(1)} KiB`,
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  ALL_CONFIGS,
  DEFAULT_DEPTH,
  DEPTHS,
  VARIANTS,
  buildAirScript,
  buildCase,
  makeCircuit,
  poseidon,
  runOnce,
  traceShape,
};
