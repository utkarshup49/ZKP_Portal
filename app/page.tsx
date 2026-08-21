import Link from "next/link";

import { ChainExplorer } from "@/components/ChainExplorer";

const PORTALS = [
  {
    href: "/university",
    role: "Issuer",
    title: "University",
    blurb:
      "Load a graduating batch, commit each credential, build the Merkle tree and publish only the root.",
    accentBar: "bg-university-700",
    accentText: "text-university-700",
    border: "hover:border-university-400",
  },
  {
    href: "/student",
    role: "Holder",
    title: "Student",
    blurb:
      "Hold your credential on this device, read what an employer is asking, and produce a proof that answers only that.",
    accentBar: "bg-student-700",
    accentText: "text-student-700",
    border: "hover:border-student-400",
  },
  {
    href: "/employer",
    role: "Verifier",
    title: "Employer",
    blurb:
      "Ask one question, check the proof against the published root, and receive a single boolean.",
    accentBar: "bg-employer-600",
    accentText: "text-employer-700",
    border: "hover:border-employer-400",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Commit",
    body: "The university hashes each credential into a leaf: Poseidon(identityCommitment, cgpaInt, degreeCode, year, institutionId, r). The blinding factor r is unique per student and secret.",
  },
  {
    n: "2",
    title: "Publish",
    body: "Every leaf in the batch goes into a Merkle tree. Only the root reaches the chain — one hash for the whole cohort.",
  },
  {
    n: "3",
    title: "Distribute",
    body: "The student privately receives their fields, their r, their leaf index and their Merkle path. None of this is ever on-chain.",
  },
  {
    n: "4",
    title: "Prove",
    body: "The student shows they know the secret behind their identity commitment, that their leaf sits under the published root, and that their CGPA clears the threshold — revealing none of those values.",
  },
  {
    n: "5",
    title: "Verify",
    body: "The employer checks the proof against the root on chain and gets back one bit: true or false.",
  },
];

export default function LandingPage() {
  return (
    <div className="space-y-12">
      <section>
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-ink-faint">
          Zero-knowledge academic credentials
        </p>
        <h1 className="mt-3 max-w-4xl text-5xl font-bold leading-tight tracking-tight text-ink">
          Prove your CGPA clears the bar. Reveal nothing else.
        </h1>
        <p className="mt-5 max-w-3xl text-xl leading-relaxed text-ink-soft">
          An employer asks one question — <em>is this person&rsquo;s CGPA at least
          8?</em> — and learns only the answer. Not the actual CGPA, not the
          subject marks, not the roll number, not which graduate this is.
        </p>
      </section>

      <section>
        <div className="grid gap-5 md:grid-cols-3">
          {PORTALS.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className={`card block p-6 transition hover:shadow-md ${portal.border}`}
            >
              <div className={`mb-4 h-1.5 w-16 rounded-full ${portal.accentBar}`} />
              <p
                className={`text-sm font-bold uppercase tracking-[0.16em] ${portal.accentText}`}
              >
                {portal.role}
              </p>
              <h2 className="mt-1.5 text-2xl font-bold text-ink">{portal.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-ink-soft">
                {portal.blurb}
              </p>
              <p className={`mt-4 text-base font-semibold ${portal.accentText}`}>
                Open portal &rarr;
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-ink">How it works</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-5">
          {STEPS.map((step) => (
            <li key={step.n} className="card p-5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-base font-bold text-white">
                {step.n}
              </span>
              <h3 className="mt-3 text-lg font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card border-employer-300 bg-employer-50 p-6">
        <h2 className="text-xl font-bold text-employer-900">
          What is simulated here
        </h2>
        <p className="mt-2 max-w-4xl text-base leading-relaxed text-employer-900">
          The Groth16 proof object is synthesised, and the blockchain is a JSON
          file. Everything else runs for real: Poseidon commitments, the Merkle
          tree and its authentication paths, every constraint check, the
          nullifier, and the on-chain root and revocation lookups. A student
          below the threshold genuinely cannot generate a proof.
        </p>
      </section>

      <ChainExplorer />
    </div>
  );
}
