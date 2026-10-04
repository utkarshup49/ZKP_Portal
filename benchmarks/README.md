# Real STARK results

This directory contains a reproducible performance experiment for the four
staged algorithms in `main-2.pdf`: CP, MCM, IBRR, and RA.

## What is real

The harness instantiates an algebraic intermediate representation with
`@guildofweavers/genstark` and generates Fiat-Shamir/FRI STARK proofs. The AIR
uses Poseidon (`t = 6`, `alpha = 5`, 8 full and 55 partial rounds), a private
10-bit decomposition for `cgpaInt >= threshold`, private issuance paths, a
session-bound nullifier, and a second private validity-tree path for RA. The
negative test rejects altered range bits, altered paths, a stronger threshold,
and a different session nonce.

The measured credential is `BTECH/27431/23` from
`data/sample-students.csv` (CGPA 8.34, threshold 8.00). Deeper paths are
deterministically expanded from that credential so every requested depth uses
the same private statement apart from path length.

## Important scope note

This is a real STARK backend, but it is not wired into the Next.js UI. The UI's
`lib/prover.ts` remains an explicitly documented proof stub. The benchmark uses
genSTARK's optimized 128-bit prime field, not the application's BN254
`poseidon-lite` instance. The paper must state that backend distinction. The
reported 96-100 bit value is genSTARK's experimental security estimate; the
library describes itself as research-grade and unaudited.

The commitment AIR absorbs four field elements. The fourth is a private digest
of the remaining credential metadata and blinding material. Thus the benchmark
binds the application data but is not byte-compatible with `lib/credential.ts`.

## Protocol and measurements

- Host: recorded verbatim in `results/metadata.json`.
- Default depth: `d = 13`.
- Repetitions: 30 per staged variant, each in a fresh process after one warm-up.
- Scaling depths: `4, 8, 10, 13, 16, 20`; three runs per non-default depth.
- Concurrency: 280 RA verifications arriving together at an 8-worker pool.
- Timing: `performance.now()` wall-clock time.
- Proof size: genSTARK binary serialization.
- Memory: maximum observed process RSS immediately after proving. It is not a
  sampled high-water mark and is labeled accordingly in the figure.
- Trace lengths are powers of two. Requested depths that share a padded trace
  length can form plateaus; this is not smoothed out of the results.

Run the experiment and rebuild the figures:

```powershell
npm run check:stark
npm run benchmark:stark
npm run benchmark:figures
powershell -ExecutionPolicy Bypass -File benchmarks/export-pdfs.ps1
```

## Outputs

- `results/raw-runs.csv` and `.json`: every measured proof.
- `results/summary.csv` and `.json`: grouped metrics.
- `results/verification-cdf.csv` and `.json`: all 280 request latencies.
- `figures/figure-01` through `figure-06`: SVG, 300-DPI PNG, and PDF.

Figure 3 uses hollow markers for contextual literature points. They are not
hardware- or statement-normalized:

- Groth16: 128 bytes and 2 ms from the comparison in
  <https://eprint.iacr.org/2024/1914>.
- Bulletproofs: 672 bytes and 1.518970 ms for one 64-bit range proof, reported
  as the baseline in <https://eprint.iacr.org/2020/735>.
- Reference STARK: 110 KiB and 4.4 ms for the 64-signature Winterfell benchmark
  in <https://github.com/facebook/winterfell>.

There is no gas waterfall because this repository contains no deployable
contract and no Sepolia/Amoy deployment. Adding invented gas values would make
the results less credible, not more.
