# ZK Credential Verification — demo

Three parties, one question, one bit of disclosure.

A university issues grade cards. A student holds theirs privately. An employer
asks *"is this person's CGPA at least 8?"* — and learns **only the answer**. Not
the actual CGPA, not the subject marks, not the roll number, not which graduate
this is.

---

## Setup

```bash
git clone https://github.com/utkarshup49/ZKP_Portal.git
cd ZKP_Portal
npm install
npm run dev
```

Open <http://localhost:3000>. That is the whole setup — no database, no Docker,
no external services, no chain.

Optional utilities:

| Command | Does |
| --- | --- |
| `npm run reset:chain` | Reset `data/chain.json` to its seed state (do this between rehearsals) |
| `npm run gen:sample` | Regenerate `data/sample-students.csv` |
| `npm run check:e2e` | Headless walk through every acceptance criterion (51 checks) |
| `npm run check:http` | Same, but against a running dev server, with a network-leak audit |
| `npm run build` | Production build |

---

## The three portals

### `/university` — the issuer

The registrar's console.

- **A. Load students** — upload an intake CSV, or click *Load sample data* for
  the 20 seed students. Columns: `name, rollNumber, identityCommitment, cgpa,
  degreeCode, year`. A blank or `auto` commitment is derived from the roll
  number, so a hand-written CSV works too.
- **B. Build the batch** — draws a fresh 256-bit blinding factor `r` per
  student, commits each credential to a leaf, and builds the Merkle tree. Empty
  slots are padded with `Poseidon(dummy)` for a fixed domain-separated dummy —
  never with zero.
- **C. Publish** — POSTs *four fields* to the chain: root, semester ID, leaf
  count, depth. The exact request body is shown on screen before you send it,
  and the API route rejects any other field outright.
- **D. Distribute** — download `credential-{rollNumber}.json` per student, or
  all at once. Each bundle holds the credential fields, `r`, the leaf index and
  the Merkle path. None of it is on chain.
- **E. Revocation** — publishes a leaf hash to the on-chain revocation list.

### `/student` — the holder

The wallet. **The credential lives in React state and nowhere else** — no
localStorage, no server, no API call. Refreshing the page wipes it.

- **A. Import** — drag in a bundle, or use *Load demo student* (which rebuilds
  and publishes the sample batch first, standing in for the university).
- **B. My credential** — your fields, shown to you and only you.
- **C. Verification request** — paste the employer's JSON or pull it from the
  employer tab, then read it in plain English.
- **D. Generate proof** — six steps, each a real computation. On success you get
  the proof plus a **"What the employer will see"** panel. Put those two side by
  side; that contrast is the demo.

### `/employer` — the verifier

- **A. Build a request** — threshold slider (CGPA 0–10, transmitted as
  `cgpa × 100`), degree dropdown, year range, and a fresh 128-bit nonce per
  session.
- **B. Verify a proof** — pick the batch root you accept, paste or pull a proof,
  and get a large **TRUE** or **FALSE** plus a five-item checklist.
- **C. What the employer learned** — the two-column panel. This is the point.

A **Blockchain Explorer** at the bottom of the landing page shows live chain
state throughout.

---

## Scripted 5-minute demo

Reset first: `npm run reset:chain`, then `npm run dev`.

Open three tabs: `/university`, `/student`, `/employer`.

**0:00 — Frame it** (landing page)
> "Three parties. The employer will ask one question and learn one bit."

Point at the Blockchain Explorer: one historical batch, nothing revoked.

**0:30 — Issue the batch** (university tab)

1. Click **Load sample data** → 20 students appear, CGPAs visible in the table.
2. Click **Build Merkle Tree** → read the root aloud; note depth 5, 32 leaf
   slots, 20 real credentials, 12 padding leaves.
3. Semester ID is already `2027-SPRING`. Before clicking, point at the *"Exact
   request body sent to the chain"* block:
   > "Four fields. No name, no CGPA. That is everything the chain ever sees."
4. Click **Publish to Blockchain**.

**1:30 — Hand over a credential** (university tab)

5. In section D, find **Aarav Sharma / BTECH/27431/23 / CGPA 8.34** and click
   **Download Bundle**.
   > "This file is handed over privately. It never touches the chain."

**2:00 — Ask the question** (employer tab)

6. Leave the threshold at **8.0** and the degree at **1101 — B.Tech CSE**.
7. Click **Generate Request**. Point at the nonce:
   > "Fresh per session, so this proof can't be reused anywhere else."
8. Click **Send to student tab**.

**2:45 — Prove it** (student tab)

9. Drag in `credential-BTECH-27431-23.json`. The card shows CGPA **8.34**.
10. Click **Load from employer tab** → the request renders in plain English.
11. Click **Generate Proof**. Read the six steps as they tick through.
12. **Stop here.** Put the proof JSON and the *"What the employer will see"*
    panel side by side.
    > "The card says 8.34. Now find 8.34 in the right-hand panel. It isn't
    > there — the employer gets a threshold of 800, a root, a nonce and a
    > nullifier."
13. Click **Send to employer tab**.

**3:45 — Verify** (employer tab)

14. Click **Load from student tab**, then **Verify** → a large green **TRUE**
    and five green checks.
15. Scroll to **What the employer learned**. Read the two columns aloud. This is
    the payoff.

**4:15 — Show soundness** (student tab)

16. Drag in `credential-BTECH-27155-23.json` (Karan Malhotra, CGPA 6.40). Or
    click the second *Load demo student* button.
17. Click **Load from employer tab**, then **Generate Proof**.
18. The first three steps pass; step 4 fails red:
    *"CGPA constraint failed: the credential does not satisfy cgpaInt >= 800."*
    > "He can't lie. There is no proof of a false statement, so there is nothing
    > to produce."

**4:45 — Revoke** (university tab → employer tab)

19. In section E, click **Revoke** on Aarav's row.
20. Back on the employer tab, click **Verify** again on the same proof →
    **FALSE**, failing at *"Credential not present in revocation list"*.

---

## What is simulated vs. what is real

### Simulated

**The Groth16 proof object.** `pi_a` / `pi_b` / `pi_c` are deterministic
Poseidon-derived field elements shaped like a real proof. `verifyProof` checks
their shape, not a pairing equation. The single boundary is marked at the top of
[`lib/prover.ts`](lib/prover.ts):

```
// STUB BOUNDARY — replace generateProof/verifyProof with snarkjs
// (groth16.fullProve / groth16.verify) once the Circom circuit is compiled.
// Everything else in this codebase stays unchanged.
```

**The blockchain.** `data/chain.json` behind three API routes, standing in for
contract storage.

**The issuer signature.** `batch.signature` is a placeholder. A real deployment
verifies an ECDSA signature over `(root, semesterId, leafCount)` against the
public key in `issuerRegistry` before accepting a root. Nothing verifies it
here.

**The identity secret's origin.** The university ships a derivable
`identitySecret` inside the bundle so the walkthrough has no registration step.
In production the student generates it with `crypto.getRandomValues` at
registration and registers only `Poseidon(identitySecret, IDENTITY_DOMAIN)`; the
university is never in a position to know the secret.

### Real

Everything else, and all of it can fail:

- **Poseidon hashing** — `poseidon-lite` over the BN254 scalar field, identical
  in Node and browser.
- **Commitments** — `leaf = Poseidon(identityCommitment, cgpaInt, degreeCode,
  year, institutionId, r)` with a genuine 256-bit random `r` per student.
- **The Merkle tree** — built for real, padded with `Poseidon(dummy)`, real
  authentication paths, and `computeRootFromPath` genuinely folds a leaf back to
  the root inside `generateProof`.
- **Every constraint** — identity preimage, leaf reconstruction, Merkle
  inclusion, `cgpaInt >= threshold`, degree match, year range, on-chain root
  lookup, revocation non-membership. Each throws a `ProofConstraintError` naming
  the constraint that failed.
- **The nullifier** — `Poseidon(identitySecret, nonce, NULLIFIER_DOMAIN)`,
  recomputed every time.
- **Verification** — the root is looked up in live chain state, public inputs
  are compared against the request the employer issued, the nonce is checked for
  freshness, and the revocation accumulator is recomputed from the chain.
- **The privacy claim** — no credential field reaches any API route.
  `npm run check:http` records every request body the app sends and asserts that
  none contains a CGPA, name, roll number, blinding factor, identity secret or
  identity commitment.

### What a real circuit would add

The checks above run in the holder's own browser. A student running *modified*
code could skip them. That is exactly the gap a compiled Circom circuit closes:
the pairing check makes the constraints unforgeable rather than merely
unskipped-by-honest-clients. Swapping the two function bodies in
`lib/prover.ts` for `groth16.fullProve` / `groth16.verify` is the whole of the
remaining work — no other file changes.

---

## Design notes worth knowing

**`revocationRoot` is a sixth public input.** The brief specifies five. The
extra one is an accumulator over the chain's revocation set at proving time, and
it exists because the employer must be able to confirm non-revocation *without*
learning which leaf the holder owns — publishing the leaf would identify them
among the batch and undo the privacy everything else buys. The holder checks
non-membership and commits to the accumulator; the verifier recomputes it from
live chain state.

The honest consequence: **any** change to the revocation set makes previously
issued proofs stale, not just the revoked holder's. Accumulator-based revocation
behaves this way in practice — holders refresh against the current accumulator.
A revoked holder who refreshes fails at `generateProof` instead; an unrevoked
classmate simply gets a fresh valid proof.

**Anonymity set.** Trees are padded to a minimum depth of 5, so a 20-student
demo cohort still hides in 32 leaf slots. The employer's *"which of the N
graduates"* line reads N from the actual published batch.

**Tree depth.** The step list shows the real depth (5 levels for the sample
batch), not a hard-coded number.

---

## Layout

```
ZKP_Portal/
├── app/
│   ├── page.tsx                    # landing + Blockchain Explorer
│   ├── university/page.tsx         # reads the sample CSV server-side
│   ├── student/page.tsx
│   ├── employer/page.tsx
│   └── api/chain/{publish,roots,revoke}/route.ts
├── components/                     # portals + shared UI
├── lib/
│   ├── poseidon.ts                 # hash wrapper, field arithmetic
│   ├── merkle.ts                   # tree, paths, verification
│   ├── credential.ts               # types, commitments, bundle format, CSV
│   ├── prover.ts                   # STUB BOUNDARY lives here
│   ├── chain.ts                    # chain types + browser client
│   ├── chainStore.ts               # server-only file I/O
│   └── handoff.ts                  # localStorage tab handoff (public data only)
├── data/
│   ├── chain.json                  # the simulated ledger
│   ├── chain.seed.json             # reset target
│   └── sample-students.csv         # 20 seed students
└── scripts/                        # data generation + acceptance checks
```

`lib/chain.ts`, `lib/chainStore.ts` and `lib/handoff.ts` are additions to the
structure in the brief: chain access is split so `fs` never reaches the client
bundle, and the tab handoff is isolated so it is obvious at a glance that only
public artefacts go through localStorage.

---

## Sample roster

20 students, deliberately spread so both outcomes are one click away:

- **15 at or above CGPA 8.00** — proofs succeed.
- **5 below 8.00** — proof generation fails at the CGPA constraint.
- **Mixed degree codes** (`1101` B.Tech CSE, `1102` B.Tech ECE, `1201` M.Tech
  CSE) — including Nikhil Pillai at CGPA 9.20 in ECE and Shreya Kulkarni at 8.88
  in M.Tech, so the *attribute* constraint can be shown failing on a student who
  clears the threshold comfortably.

| Demo student | Roll | CGPA | Programme | Use for |
| --- | --- | --- | --- | --- |
| Aarav Sharma | `BTECH/27431/23` | 8.34 | B.Tech CSE | the happy path |
| Karan Malhotra | `BTECH/27155/23` | 6.40 | B.Tech CSE | soundness (CGPA fails) |
| Nikhil Pillai | `BTECH/27633/23` | 9.20 | B.Tech ECE | attribute mismatch |
