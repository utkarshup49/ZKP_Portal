# Paper-ready results notes

## Table 5 replacement

All timing entries are medians over 30 independent warmed processes at requested
Merkle depth `d = 13`.

| Metric | CP | MCM | IBRR | RA |
| --- | ---: | ---: | ---: | ---: |
| Prover time (ms) | 103.2 | 2,003.2 | 2,600.4 | 3,506.1 |
| Verifier time (ms) | 27.1 | 46.2 | 60.8 | 68.6 |
| Proof size (KiB) | 76.8 | 114.9 | 123.3 | 136.3 |
| Observed post-proof RSS (MiB) | 84 | 440 | 546 | 655 |
| Execution trace length | 64 | 1,024 | 1,024 | 1,024 |
| AIR transition constraints | 11 | 11 | 17 | 23 |
| genSTARK security estimate (bits) | 100 | 96 | 96 | 96 |

Do not relabel the RSS row as a sampled high-water mark. Do not relabel AIR
transition constraints as R1CS constraints.

## Suggested results paragraph

On a 12th-generation Intel Core i5-1235U with 16 GB RAM, Windows 10 x64, Node
22.23.3 and genSTARK 0.7.6, median proof generation increased from 103.2 ms for
CP to 2,003.2 ms when private issuance membership was added at requested depth
13. Session binding added a further 597.2 ms, and the second validity-tree path
added 905.7 ms, bringing RA to 3,506.1 ms. Median verification remained below
70 ms for all variants. Serialized proof size grew from 76.8 KiB for CP to
136.3 KiB for RA. Across requested depths 4-20, fitted log-log slopes were
0.77, 0.89 and 0.74 for MCM, IBRR and RA proof time respectively, and 0.09 for
proof size in all three cases. The stepwise curves reflect the prover's
power-of-two execution-trace padding and should not be interpreted as smooth
per-level growth.

Under a burst of 280 simultaneous RA verification requests served by eight
workers, all proofs verified successfully. End-to-end latency, including queue
time, was 2,514 ms at p50, 4,421 ms at p95 and 4,622 ms at p99; aggregate
throughput was 60.2 verifications per second.

## Suggested captions

**Figure 9. Marginal prover cost of staged security properties.** Each bar is
the median of 30 real FRI proof runs at requested Merkle depth 13. Slabs are
measured wall-clock deltas between adjacent variants: commitment, bounded
predicate, private issuance membership, session-bound nullifier and private
validity-tree membership.

**Figure 10. Merkle-depth scaling.** Mean proof time and serialized proof size
for requested depths 4, 8, 10, 13, 16 and 20 on log-log axes. Labels report the
ordinary least-squares slope in log space. Non-power-of-two requests share
padded trace sizes, producing visible plateaus.

**Figure 11. Proof-size/verification-time trade-off.** Filled markers are local
measurements of the four staged variants. Hollow markers are contextual values
reported by other implementations and are not normalized for statement,
security level, implementation language or hardware.

**Figure 12. Six metrics across the staged variants.** Timing values are
medians over 30 runs. Memory is maximum observed resident set immediately after
proof generation. Constraint counts denote AIR transition constraints.

**Figure 13. Proof-generation distributions.** Boxes show the interquartile
range and median; points show all 30 runs. Each observation was collected in a
fresh process after one warm-up proof.

**Figure 14. Concurrent RA verification latency.** Empirical CDF for 280
requests submitted simultaneously to eight verification workers. Latency is
measured from common arrival time and therefore includes queueing.

## Required limitation sentence

The benchmark instantiates the paper's staged logic in a real research-grade
FRI backend over genSTARK's optimized 128-bit Poseidon field; it is not
byte-compatible with the portal's BN254 `poseidon-lite` commitments, and the
portal UI still emits its documented proof stub. The benchmark therefore
supports performance claims about this experimental STARK instantiation, not a
claim that the supplied web portal has become production-sound.
