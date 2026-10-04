const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const RESULTS = path.join(__dirname, "results");
const FIGURES = path.join(__dirname, "figures");
const W = 1400;
const H = 900;
const FONT = "Arial, Helvetica, sans-serif";
const COLORS = {
  ink: "#17212B",
  muted: "#5F6B76",
  grid: "#D8DEE4",
  paper: "#FFFFFF",
  blue: "#0072B2",
  orange: "#E69F00",
  green: "#009E73",
  vermilion: "#D55E00",
  purple: "#CC79A7",
  sky: "#56B4E9",
};
const VARIANTS = ["CP", "MCM", "IBRR", "RA"];
const VARIANT_COLORS = {
  CP: COLORS.blue,
  MCM: COLORS.green,
  IBRR: COLORS.orange,
  RA: COLORS.vermilion,
};

const summary = JSON.parse(fs.readFileSync(path.join(RESULTS, "summary.json"), "utf8"));
const raw = JSON.parse(fs.readFileSync(path.join(RESULTS, "raw-runs.json"), "utf8"));
const cdf = JSON.parse(fs.readFileSync(path.join(RESULTS, "verification-cdf.json"), "utf8"));
const refs = JSON.parse(fs.readFileSync(path.join(__dirname, "reference-data.json"), "utf8"));

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(x, y, value, options = {}) {
  const {
    size = 24,
    weight = 400,
    fill = COLORS.ink,
    anchor = "start",
    rotate = 0,
    opacity = 1,
  } = options;
  const transform = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${transform}>${esc(value)}</text>`;
}

function line(x1, y1, x2, y2, options = {}) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${options.stroke || COLORS.grid}" stroke-width="${options.width || 1}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ""} />`;
}

function rect(x, y, width, height, options = {}) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${options.fill || "none"}" stroke="${options.stroke || "none"}" stroke-width="${options.strokeWidth || 0}" rx="${options.rx || 0}" opacity="${options.opacity ?? 1}" />`;
}

function circle(cx, cy, r, options = {}) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${options.fill || "none"}" stroke="${options.stroke || "none"}" stroke-width="${options.strokeWidth || 0}" opacity="${options.opacity ?? 1}" />`;
}

function pathEl(points, options = {}) {
  const d = points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ");
  return `<path d="${d}" fill="${options.fill || "none"}" stroke="${options.stroke || COLORS.ink}" stroke-width="${options.width || 3}" stroke-linejoin="round" stroke-linecap="round"${options.dash ? ` stroke-dasharray="${options.dash}"` : ""} />`;
}

function svgFrame(title, subtitle, body, footer = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${rect(0, 0, W, H, { fill: COLORS.paper })}
  ${text(70, 64, title, { size: 34, weight: 700 })}
  ${text(70, 100, subtitle, { size: 19, fill: COLORS.muted })}
  ${body}
  ${footer ? text(70, H - 28, footer, { size: 16, fill: COLORS.muted }) : ""}
</svg>`;
}

function variantSummary(name) {
  return summary.find((row) => row.phase === "variants" && row.variant === name);
}

function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function regressionSlope(points) {
  const xs = points.map((point) => Math.log(point.x));
  const ys = points.map((point) => Math.log(point.y));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const numerator = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const denominator = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return numerator / denominator;
}

function logScale(domainMin, domainMax, rangeMin, rangeMax) {
  const a = Math.log(domainMin);
  const b = Math.log(domainMax);
  return (value) => rangeMin + ((Math.log(value) - a) / (b - a)) * (rangeMax - rangeMin);
}

function linearScale(domainMin, domainMax, rangeMin, rangeMax) {
  return (value) => rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function figureCost() {
  const commit = variantSummary("COMMIT").prover_median_ms;
  const totals = Object.fromEntries(VARIANTS.map((name) => [name, variantSummary(name).prover_median_ms]));
  const components = [
    { key: "commitment", label: "Commitment", color: COLORS.blue, value: commit },
    { key: "predicate", label: "Predicate", color: COLORS.purple, value: Math.max(0, totals.CP - commit) },
    { key: "merkle", label: "Merkle path", color: COLORS.green, value: Math.max(0, totals.MCM - totals.CP) },
    { key: "nullifier", label: "Nullifier", color: COLORS.orange, value: Math.max(0, totals.IBRR - totals.MCM) },
    { key: "revocation", label: "Revocation", color: COLORS.vermilion, value: Math.max(0, totals.RA - totals.IBRR) },
  ];
  const included = {
    CP: ["commitment", "predicate"],
    MCM: ["commitment", "predicate", "merkle"],
    IBRR: ["commitment", "predicate", "merkle", "nullifier"],
    RA: components.map((item) => item.key),
  };
  const left = 150;
  const top = 155;
  const bottom = 760;
  const max = 4000;
  const y = linearScale(0, max, bottom, top);
  let body = "";
  for (const tick of [0, 1000, 2000, 3000, 4000]) {
    body += line(left, y(tick), 1030, y(tick));
    body += text(left - 18, y(tick) + 7, tick.toLocaleString(), { size: 18, anchor: "end", fill: COLORS.muted });
  }
  body += text(42, 460, "Median prover time (ms)", { size: 20, weight: 600, rotate: -90, anchor: "middle" });
  VARIANTS.forEach((variant, index) => {
    const x = 230 + index * 205;
    let cumulative = 0;
    for (const component of components) {
      if (!included[variant].includes(component.key)) continue;
      const y0 = y(cumulative);
      cumulative += component.value;
      const y1 = y(cumulative);
      body += rect(x, y1, 118, y0 - y1, { fill: component.color, stroke: "#FFFFFF", strokeWidth: 2 });
      if (y0 - y1 > 34) {
        body += text(x + 59, (y0 + y1) / 2 + 7, `${Math.round(component.value)} ms`, { size: 16, weight: 700, fill: "#FFFFFF", anchor: "middle" });
      }
    }
    body += text(x + 59, bottom + 40, variant, { size: 22, weight: 700, anchor: "middle" });
    body += text(x + 59, y(cumulative) - 14, `${Math.round(totals[variant]).toLocaleString()} ms`, { size: 18, weight: 700, anchor: "middle" });
  });
  components.forEach((component, index) => {
    const x = 1080;
    const yy = 190 + index * 48;
    body += rect(x, yy - 18, 24, 24, { fill: component.color });
    body += text(x + 38, yy + 2, component.label, { size: 18 });
  });
  return svgFrame(
    "Marginal cost of each security property",
    "Measured deltas between staged variants; median of 30 proofs at requested Merkle depth d = 13",
    body,
    "Real 96–100-bit FRI proofs; slabs are marginal wall-clock deltas, not operation-count estimates.",
  );
}

function scalingRows(variant) {
  const rows = summary.filter((row) => row.variant === variant && row.phase === "scaling");
  rows.push(variantSummary(variant));
  return rows.sort((a, b) => a.depth - b.depth);
}

function plotLogPanel({ x0, y0, width, height, title, valueKey, unit, yDomain, yTicks }) {
  const x = logScale(4, 20, x0, x0 + width);
  const y = logScale(yDomain[0], yDomain[1], y0 + height, y0);
  let body = text(x0, y0 - 25, title, { size: 23, weight: 700 });
  for (const tick of [4, 8, 10, 13, 16, 20]) {
    body += line(x(tick), y0, x(tick), y0 + height, { stroke: "#EEF1F3" });
    body += text(x(tick), y0 + height + 30, tick, { size: 16, anchor: "middle", fill: COLORS.muted });
  }
  for (const tick of yTicks) {
    body += line(x0, y(tick), x0 + width, y(tick));
    body += text(x0 - 14, y(tick) + 6, tick >= 1000 ? `${tick / 1000}k` : tick, { size: 16, anchor: "end", fill: COLORS.muted });
  }
  body += line(x0, y0 + height, x0 + width, y0 + height, { stroke: COLORS.ink, width: 2 });
  body += line(x0, y0, x0, y0 + height, { stroke: COLORS.ink, width: 2 });
  for (const variant of ["MCM", "IBRR", "RA"]) {
    const rows = scalingRows(variant);
    const points = rows.map((row) => ({ x: row.depth, y: row[valueKey] }));
    body += pathEl(points.map((point) => [x(point.x), y(point.y)]), { stroke: VARIANT_COLORS[variant], width: 4 });
    for (const point of points) body += circle(x(point.x), y(point.y), 6, { fill: COLORS.paper, stroke: VARIANT_COLORS[variant], strokeWidth: 4 });
    const slope = regressionSlope(points);
    const ly = y0 + 30 + ["MCM", "IBRR", "RA"].indexOf(variant) * 30;
    body += line(x0 + width - 155, ly - 7, x0 + width - 125, ly - 7, { stroke: VARIANT_COLORS[variant], width: 4 });
    body += text(x0 + width - 116, ly, `${variant}  slope ${slope.toFixed(2)}`, { size: 15, weight: 600 });
  }
  body += text(x0 + width / 2, y0 + height + 66, "Requested Merkle depth, d (log scale)", { size: 17, anchor: "middle" });
  body += text(x0 - 72, y0 + height / 2, `${unit} (log scale)`, { size: 17, anchor: "middle", rotate: -90 });
  return body;
}

function figureScaling() {
  let body = plotLogPanel({
    x0: 120, y0: 180, width: 500, height: 540,
    title: "A. Proof generation time", valueKey: "prover_mean_ms", unit: "Time (ms)",
    yDomain: [1000, 14000], yTicks: [1000, 2000, 5000, 10000],
  });
  body += plotLogPanel({
    x0: 805, y0: 180, width: 500, height: 540,
    title: "B. Serialized proof size", valueKey: "proof_bytes", unit: "Size (bytes)",
    yDomain: [100000, 170000], yTicks: [100000, 120000, 140000, 160000],
  });
  return svgFrame(
    "Merkle-depth scaling",
    "Log–log fits over d ∈ {4, 8, 10, 13, 16, 20}; n = 3 per depth (n = 30 at d = 13)",
    body,
    "Trace lengths round to powers of two; visible plateaus are a measured STARK padding effect.",
  );
}

function figurePareto() {
  const local = VARIANTS.map((variant) => ({
    label: variant,
    proof_kib: variantSummary(variant).proof_bytes / 1024,
    verify_ms: variantSummary(variant).verifier_median_ms,
    local: true,
    color: VARIANT_COLORS[variant],
  }));
  const points = [...local, ...refs.map((item) => ({ ...item, local: false, color: COLORS.ink }))];
  const left = 145, top = 160, width = 1090, height = 610;
  const x = logScale(0.08, 220, left, left + width);
  const y = logScale(1, 100, top + height, top);
  let body = "";
  for (const tick of [0.1, 1, 10, 100]) {
    body += line(x(tick), top, x(tick), top + height);
    body += text(x(tick), top + height + 34, tick, { size: 17, anchor: "middle", fill: COLORS.muted });
  }
  for (const tick of [1, 2, 5, 10, 20, 50, 100]) {
    body += line(left, y(tick), left + width, y(tick));
    body += text(left - 18, y(tick) + 6, tick, { size: 17, anchor: "end", fill: COLORS.muted });
  }
  body += line(left, top + height, left + width, top + height, { stroke: COLORS.ink, width: 2 });
  body += line(left, top, left, top + height, { stroke: COLORS.ink, width: 2 });
  const offsets = {
    CP: [12, 28], MCM: [-8, -18], IBRR: [12, 30], RA: [12, 8],
    Groth16: [12, 28], Bulletproofs: [12, -14], "Reference STARK": [-8, -18],
  };
  for (const point of points) {
    const px = x(point.proof_kib), py = y(point.verify_ms);
    body += circle(px, py, point.local ? 10 : 9, point.local
      ? { fill: point.color, stroke: "#FFFFFF", strokeWidth: 2 }
      : { fill: COLORS.paper, stroke: COLORS.ink, strokeWidth: 3 });
    const [dx, dy] = offsets[point.label] || [10, -10];
    body += text(px + dx, py + dy, point.label, { size: 18, weight: 700, anchor: dx < 0 ? "end" : "start" });
  }
  body += text(left + width / 2, 845, "Proof size (KiB, log scale)", { size: 20, weight: 600, anchor: "middle" });
  body += text(46, top + height / 2, "Verification time (ms, log scale)", { size: 20, weight: 600, anchor: "middle", rotate: -90 });
  body += circle(980, 126, 8, { fill: COLORS.blue });
  body += text(998, 132, "This work, local", { size: 16 });
  body += circle(1160, 126, 7, { fill: COLORS.paper, stroke: COLORS.ink, strokeWidth: 2 });
  body += text(1177, 132, "Literature", { size: 16 });
  return svgFrame(
    "Proof-size / verification-time trade-off",
    "Local staged variants at d = 13; external points are contextual references, not normalized benchmarks",
    body,
    "External statements, implementations, security levels, and hardware differ; do not read rank order as an apples-to-apples result.",
  );
}

function miniBarPanel(x0, y0, width, height, title, values, formatter) {
  const max = Math.max(...values.map((item) => item.value)) * 1.12;
  const y = linearScale(0, max, y0 + height - 45, y0 + 42);
  let body = text(x0, y0 + 20, title, { size: 20, weight: 700 });
  body += line(x0 + 18, y0 + height - 45, x0 + width - 10, y0 + height - 45, { stroke: COLORS.ink, width: 1.5 });
  values.forEach((item, index) => {
    const barWidth = 64;
    const gap = (width - 70) / values.length;
    const x = x0 + 36 + index * gap;
    const yy = y(item.value);
    body += rect(x, yy, barWidth, y0 + height - 45 - yy, { fill: VARIANT_COLORS[item.variant] });
    body += text(x + barWidth / 2, yy - 8, formatter(item.value), { size: 14, weight: 700, anchor: "middle" });
    body += text(x + barWidth / 2, y0 + height - 18, item.variant, { size: 15, weight: 700, anchor: "middle" });
  });
  return body;
}

function figureMultiples() {
  const rows = VARIANTS.map(variantSummary);
  const metrics = [
    ["A. Prover time", (row) => row.prover_median_ms, (v) => `${(v / 1000).toFixed(2)} s`],
    ["B. Verifier time", (row) => row.verifier_median_ms, (v) => `${v.toFixed(1)} ms`],
    ["C. Proof size", (row) => row.proof_bytes / 1024, (v) => `${v.toFixed(1)} KiB`],
    ["D. Observed peak RSS", (row) => row.rss_after_peak_bytes / 2 ** 20, (v) => `${Math.round(v)} MiB`],
    ["E. Execution trace", (row) => row.trace_length, (v) => v.toLocaleString()],
    ["F. AIR transition constraints", (row) => row.constraint_count, (v) => String(v)],
  ];
  let body = "";
  metrics.forEach(([title, getter, formatter], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    body += miniBarPanel(
      50 + column * 450,
      135 + row * 365,
      420,
      320,
      title,
      rows.map((item) => ({ variant: item.variant, value: getter(item) })),
      formatter,
    );
  });
  return svgFrame(
    "Six views of the staged variants",
    "Median timing and fixed proof metrics at d = 13; n = 30 independent warmed processes",
    body,
    "Memory is maximum observed resident set after proving; transition constraints are AIR column constraints, not R1CS rows.",
  );
}

function figureDistribution() {
  const left = 135, top = 150, bottom = 780;
  const values = raw.filter((row) => row.phase === "variants" && VARIANTS.includes(row.variant));
  const max = Math.ceil(Math.max(...values.map((row) => row.prover_ms)) / 500) * 500;
  const y = linearScale(0, max, bottom, top);
  let body = "";
  for (let tick = 0; tick <= max; tick += 500) {
    body += line(left, y(tick), 1260, y(tick));
    body += text(left - 16, y(tick) + 6, tick.toLocaleString(), { size: 17, anchor: "end", fill: COLORS.muted });
  }
  VARIANTS.forEach((variant, index) => {
    const x = 300 + index * 255;
    const v = values.filter((row) => row.variant === variant).map((row) => row.prover_ms);
    const q1 = quantile(v, 0.25), q2 = quantile(v, 0.5), q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    const low = Math.max(Math.min(...v), q1 - 1.5 * iqr);
    const high = Math.min(Math.max(...v), q3 + 1.5 * iqr);
    for (let i = 0; i < v.length; i += 1) {
      const jitter = Math.sin((i + 1) * 17.17) * 42;
      body += circle(x + jitter, y(v[i]), 4, { fill: VARIANT_COLORS[variant], opacity: 0.35 });
    }
    body += line(x, y(low), x, y(high), { stroke: COLORS.ink, width: 2 });
    body += line(x - 35, y(low), x + 35, y(low), { stroke: COLORS.ink, width: 2 });
    body += line(x - 35, y(high), x + 35, y(high), { stroke: COLORS.ink, width: 2 });
    body += rect(x - 58, y(q3), 116, y(q1) - y(q3), { fill: VARIANT_COLORS[variant], opacity: 0.8, stroke: COLORS.ink, strokeWidth: 1.5 });
    body += line(x - 58, y(q2), x + 58, y(q2), { stroke: "#FFFFFF", width: 4 });
    body += text(x, bottom + 42, variant, { size: 22, weight: 700, anchor: "middle" });
    body += text(x, y(q2) - 12, `${Math.round(q2)} ms`, { size: 15, weight: 700, anchor: "middle" });
  });
  body += text(42, 465, "Proof generation time (ms)", { size: 20, weight: 600, anchor: "middle", rotate: -90 });
  return svgFrame(
    "Run-to-run proof-time distribution",
    "Box plots show median and interquartile range; all 30 measurements are overlaid",
    body,
    "Each observation ran in a fresh process after one warm-up proof to isolate the backend allocator.",
  );
}

function figureCdf() {
  const sorted = cdf.slice().sort((a, b) => a.latency_ms - b.latency_ms);
  const left = 135, top = 155, width = 1110, height = 610;
  const max = Math.ceil(sorted.at(-1).latency_ms / 500) * 500;
  const x = linearScale(0, max, left, left + width);
  const y = linearScale(0, 1, top + height, top);
  let body = "";
  for (let tick = 0; tick <= max; tick += 1000) {
    body += line(x(tick), top, x(tick), top + height);
    body += text(x(tick), top + height + 34, tick.toLocaleString(), { size: 17, anchor: "middle", fill: COLORS.muted });
  }
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    body += line(left, y(tick), left + width, y(tick));
    body += text(left - 16, y(tick) + 6, `${Math.round(tick * 100)}%`, { size: 17, anchor: "end", fill: COLORS.muted });
  }
  const points = sorted.map((item, index) => [x(item.latency_ms), y((index + 1) / sorted.length)]);
  body += pathEl(points, { stroke: COLORS.blue, width: 5 });
  const percentile = (p) => quantile(sorted.map((row) => row.latency_ms), p);
  for (const [label, p, color] of [["p50", 0.5, COLORS.green], ["p95", 0.95, COLORS.orange], ["p99", 0.99, COLORS.vermilion]]) {
    const value = percentile(p);
    body += line(x(value), top, x(value), top + height, { stroke: color, width: 2, dash: "8 7" });
    body += text(x(value) - 8, top + 28 + (p === 0.5 ? 0 : p === 0.95 ? 27 : 54), `${label} ${Math.round(value)} ms`, { size: 17, weight: 700, fill: color, anchor: "end" });
  }
  body += text(left + width / 2, 850, "End-to-end latency from simultaneous arrival (ms)", { size: 20, weight: 600, anchor: "middle" });
  body += text(45, top + height / 2, "Cumulative requests", { size: 20, weight: 600, anchor: "middle", rotate: -90 });
  const throughput = sorted.length / (sorted.at(-1).latency_ms / 1000);
  body += text(950, 130, `${throughput.toFixed(1)} verifications/s`, { size: 18, weight: 700, fill: COLORS.blue });
  return svgFrame(
    "Concurrent verification latency CDF",
    `${sorted.length} RA proofs submitted together to an 8-worker pool at d = 13`,
    body,
    "Latency includes queueing behind the fixed worker pool; every verification returned valid.",
  );
}

async function writeFigure(name, svg) {
  const svgPath = path.join(FIGURES, `${name}.svg`);
  const pngPath = path.join(FIGURES, `${name}.png`);
  fs.writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg))
    .resize({ width: 2800 })
    .png({ compressionLevel: 9 })
    .withMetadata({ density: 300 })
    .toFile(pngPath);
  process.stdout.write(`[figure] ${name}.svg + ${name}.png\n`);
}

async function main() {
  fs.mkdirSync(FIGURES, { recursive: true });
  const figures = [
    ["figure-01-cost-decomposition", figureCost()],
    ["figure-02-depth-scaling", figureScaling()],
    ["figure-03-pareto", figurePareto()],
    ["figure-04-small-multiples", figureMultiples()],
    ["figure-05-proof-time-distribution", figureDistribution()],
    ["figure-06-verification-cdf", figureCdf()],
  ];
  for (const [name, svg] of figures) await writeFigure(name, svg);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
