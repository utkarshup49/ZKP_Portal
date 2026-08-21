"use client";

/**
 * Employer (verifier) portal.
 *
 * Ask one question, receive one boolean. The employer never sees a credential
 * field — only the proof and its public inputs, checked against a root that is
 * already published on chain.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEGREE_CODES,
  cgpaToInt,
  degreeName,
  describeRequest,
  intToCgpa,
  parseVerificationRequest,
  randomNonce,
  type VerificationRequest,
} from "@/lib/credential";
import {
  fetchChainState,
  findBatchByRoot,
  type BatchRecord,
  type ChainState,
} from "@/lib/chain";
import {
  getEmployerSession,
  getPendingProof,
  putEmployerSession,
  putPendingRequest,
} from "@/lib/handoff";
import {
  verifyProofDetailed,
  type Proof,
  type VerificationReport,
} from "@/lib/prover";
import {
  Button,
  Callout,
  EmptyState,
  DemoModeBanner,
  Field,
  Hash,
  JsonBlock,
  PortalHeader,
  Section,
  useCopy,
} from "@/components/ui";

const ACCENT = "employer" as const;

export function EmployerPortal() {
  /* -- Section A: request builder ----------------------------------- */
  const [thresholdCgpa, setThresholdCgpa] = useState(8);
  const [degreeCode, setDegreeCode] = useState(1101);
  const [minYear, setMinYear] = useState(2023);
  const [maxYear, setMaxYear] = useState(2027);
  const [request, setRequest] = useState<VerificationRequest | null>(null);
  const [sentToStudent, setSentToStudent] = useState(false);

  /* -- Section B: verification -------------------------------------- */
  const [chain, setChain] = useState<ChainState | null>(null);
  const [acceptedRoot, setAcceptedRoot] = useState<string>("");
  const [proofText, setProofText] = useState("");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { copied: requestCopied, copy: copyRequest } = useCopy();

  const loadChain = useCallback(async () => {
    try {
      const state = await fetchChainState();
      setChain(state);
      setAcceptedRoot((current) => {
        if (current && findBatchByRoot(state, current)) return current;
        const latest = state.batches[state.batches.length - 1];
        return latest ? latest.root : "";
      });
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    void loadChain();
  }, [loadChain]);

  // Restore the request this verifier issued, so moving between portals in one
  // tab keeps the session alive. Only the public request is restored — never a
  // credential.
  useEffect(() => {
    const restored = getEmployerSession();
    if (!restored) return;
    setRequest(restored);
    setThresholdCgpa(intToCgpa(restored.threshold));
    setDegreeCode(restored.requiredDegreeCode);
    setMinYear(restored.minYear);
    setMaxYear(restored.maxYear);
  }, []);

  /* -- Build the request -------------------------------------------- */

  const generateRequest = () => {
    const next: VerificationRequest = {
      requestId: "req-" + Date.now().toString(36),
      verifierName: "Acme Systems (hiring)",
      threshold: cgpaToInt(thresholdCgpa),
      requiredDegreeCode: degreeCode,
      minYear,
      maxYear,
      // Fresh per session. A proof is bound to this value, so it cannot be
      // lifted and replayed against a different verifier.
      nonce: randomNonce(),
      issuedAt: new Date().toISOString(),
    };
    setRequest(next);
    putEmployerSession(next);
    setSentToStudent(false);
    setReport(null);
  };

  const sendToStudent = () => {
    if (!request) return;
    putPendingRequest(request);
    setSentToStudent(true);
  };

  /* -- Verify -------------------------------------------------------- */

  const loadFromStudentTab = () => {
    const pending = getPendingProof();
    if (!pending) {
      setError(
        "No pending proof found. Generate one on the student portal and click “Send to employer tab”.",
      );
      return;
    }
    setError(null);
    setProofText(JSON.stringify(pending, null, 2));
  };

  const verify = async () => {
    if (!request) {
      setError("Generate a request first — a proof is only meaningful against one.");
      return;
    }
    setVerifying(true);
    setError(null);
    setReport(null);
    try {
      const proof = JSON.parse(proofText) as Proof;
      const state = await fetchChainState();
      setChain(state);
      const result = await verifyProofDetailed(proof, acceptedRoot, request, {
        chainState: state,
      });
      setReport(result);
    } catch (err: any) {
      setError("Could not verify: " + err.message);
    } finally {
      setVerifying(false);
    }
  };

  const acceptedBatch: BatchRecord | undefined = useMemo(() => {
    if (!chain || !acceptedRoot) return undefined;
    return findBatchByRoot(chain, acceptedRoot);
  }, [chain, acceptedRoot]);

  const cohortSize = acceptedBatch?.leafCount ?? 512;

  /* ----------------------------------------------------------------- */

  return (
    <div>
      <PortalHeader
        accent={ACCENT}
        eyebrow="Verifier"
        title="Employer portal"
        description="Acme Systems — candidate screening. Ask one question about a credential, verify the answer against the chain, and learn nothing further."
      />

      <DemoModeBanner />

      {error ? (
        <div className="mb-6">
          <Callout tone="danger">{error}</Callout>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- A */}
      <Section
        accent={ACCENT}
        step="A"
        title="Build a request"
        description="Define the single predicate you want answered. CGPA is converted to integer hundredths, because circuits compare integers."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-5">
            <Field
              label="Minimum CGPA"
              hint={`Transmitted as threshold = ${cgpaToInt(thresholdCgpa)} (CGPA × 100)`}
            >
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={thresholdCgpa}
                  onChange={(event) =>
                    setThresholdCgpa(Number(event.target.value))
                  }
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-employer-200 accent-employer-600"
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={thresholdCgpa}
                  onChange={(event) =>
                    setThresholdCgpa(
                      Math.min(10, Math.max(0, Number(event.target.value))),
                    )
                  }
                  className="input mono w-24 text-center text-xl font-bold"
                />
              </div>
            </Field>

            <Field label="Required degree">
              <select
                className="input"
                value={degreeCode}
                onChange={(event) => setDegreeCode(Number(event.target.value))}
              >
                {Object.entries(DEGREE_CODES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Year from">
                <input
                  type="number"
                  className="input mono"
                  value={minYear}
                  onChange={(event) => setMinYear(Number(event.target.value))}
                />
              </Field>
              <Field label="Year to">
                <input
                  type="number"
                  className="input mono"
                  value={maxYear}
                  onChange={(event) => setMaxYear(Number(event.target.value))}
                />
              </Field>
            </div>

            <Button accent={ACCENT} onClick={generateRequest}>
              Generate Request
            </Button>
          </div>

          <div>
            {!request ? (
              <EmptyState>
                No request yet. Set your criteria and click{" "}
                <strong>Generate Request</strong>.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border-2 border-employer-200 bg-employer-50 p-5">
                  <p className="text-sm font-bold uppercase tracking-wide text-employer-700">
                    In plain English
                  </p>
                  <p className="mt-2 text-xl font-semibold leading-snug text-ink">
                    {describeRequest(request)}
                  </p>
                </div>

                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                  title="Fresh per session — prevents a proof from being reused elsewhere"
                >
                  <span className="text-sm font-bold uppercase tracking-wide text-ink-faint">
                    Session nonce
                  </span>
                  <Hash value={request.nonce} lead={12} tail={8} />
                  <span className="cursor-help text-sm text-ink-faint underline decoration-dotted">
                    Fresh per session — prevents a proof from being reused
                    elsewhere
                  </span>
                </div>

                <JsonBlock value={request} maxHeight="18rem" />

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    accent={ACCENT}
                    variant="outline"
                    onClick={() => copyRequest(JSON.stringify(request, null, 2))}
                  >
                    {requestCopied ? "Copied" : "Copy"}
                  </Button>
                  <Button accent={ACCENT} onClick={sendToStudent}>
                    Send to student tab
                  </Button>
                  {sentToStudent ? (
                    <span className="text-base font-semibold text-employer-700">
                      Sent. Open the student portal and click &ldquo;Load from
                      employer tab&rdquo;.
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- B */}
      <Section
        accent={ACCENT}
        step="B"
        title="Verify a proof"
        description="The proof is checked against a root you already trust, and against the request you issued in this session."
        aside={
          <Button variant="outline" onClick={loadChain}>
            Refresh chain
          </Button>
        }
      >
        <div className="mb-5 max-w-2xl">
          <Field
            label="Accepted batch root"
            hint="The published batch this employer is willing to accept credentials from."
          >
            <select
              className="input mono"
              value={acceptedRoot}
              onChange={(event) => setAcceptedRoot(event.target.value)}
            >
              {!chain || chain.batches.length === 0 ? (
                <option value="">No batches published yet</option>
              ) : (
                [...chain.batches].reverse().map((batch) => (
                  <option key={batch.root} value={batch.root}>
                    {batch.semesterId} — {batch.root.slice(0, 14)}… (
                    {batch.leafCount} leaves)
                  </option>
                ))
              )}
            </select>
          </Field>
        </div>

        <div className="mb-4 flex flex-wrap gap-3">
          <Button accent={ACCENT} variant="outline" onClick={loadFromStudentTab}>
            Load from student tab
          </Button>
          <Button
            accent={ACCENT}
            onClick={verify}
            loading={verifying}
            disabled={!proofText.trim()}
          >
            Verify
          </Button>
        </div>

        <textarea
          className="input mono h-44 resize-y"
          placeholder='{ "pi_a": [...], "pi_b": [...], "pi_c": [...], "publicInputs": { ... } }'
          value={proofText}
          onChange={(event) => setProofText(event.target.value)}
        />

        {report ? (
          <div className="mt-6 space-y-5">
            <div
              className={`rounded-xl border-4 p-8 text-center ${
                report.valid
                  ? "border-student-400 bg-student-50"
                  : "border-red-400 bg-red-50"
              }`}
            >
              <p
                className={`text-sm font-bold uppercase tracking-[0.2em] ${
                  report.valid ? "text-student-700" : "text-red-700"
                }`}
              >
                Verification result
              </p>
              <p
                className={`mono mt-2 text-7xl font-bold leading-none ${
                  report.valid ? "text-student-600" : "text-red-600"
                }`}
              >
                {report.valid ? "TRUE" : "FALSE"}
              </p>
              <p
                className={`mt-3 text-lg font-semibold ${
                  report.valid ? "text-student-900" : "text-red-900"
                }`}
              >
                {report.valid
                  ? describeRequest(request!) + " — confirmed."
                  : "This proof does not satisfy the request."}
              </p>
            </div>

            <ul className="space-y-2">
              {report.checks.map((check) => (
                <li
                  key={check.id}
                  className={`flex items-start gap-3 rounded-lg border-2 px-4 py-3 ${
                    check.ok
                      ? "border-student-200 bg-student-50"
                      : "border-red-300 bg-red-50"
                  }`}
                >
                  <span
                    className={`mono text-xl font-bold leading-tight ${
                      check.ok ? "text-student-600" : "text-red-600"
                    }`}
                  >
                    {check.ok ? "✓" : "✕"}
                  </span>
                  <span>
                    <span className="block text-lg font-semibold text-ink">
                      {check.label}
                    </span>
                    <span className="block text-base leading-relaxed text-ink-soft">
                      {check.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- C */}
      <Section
        accent={ACCENT}
        step="C"
        title="What the employer learned"
        description="The whole point of the exercise: one column is everything gained, the other is everything that stayed private."
      >
        {!request ? (
          <EmptyState>Generate a request to see the comparison.</EmptyState>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border-2 border-student-300 bg-student-50 p-6">
              <h3 className="flex items-center gap-2 text-xl font-bold text-student-900">
                <span className="mono text-2xl text-student-600">✓</span>
                Learned
              </h3>
              <ul className="mt-4 space-y-3">
                {[
                  `CGPA is at least ${intToCgpa(request.threshold).toFixed(1)}`,
                  `Degree is ${degreeName(request.requiredDegreeCode)}`,
                  "Issued by an accredited university on the issuer registry",
                  request.minYear === request.maxYear
                    ? `Issued in ${request.minYear}`
                    : `Issued between ${request.minYear} and ${request.maxYear}`,
                  "The credential is not revoked",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-lg leading-relaxed text-student-900"
                  >
                    <span className="mono font-bold text-student-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-6">
              <h3 className="flex items-center gap-2 text-xl font-bold text-red-900">
                <span className="mono text-2xl text-red-600">✕</span>
                Did not learn
              </h3>
              <ul className="mt-4 space-y-3">
                {[
                  "The actual CGPA",
                  "Name, roll number",
                  "Subject marks",
                  `Which of the ${cohortSize} graduates this is`,
                  "Whether this is the same person as any previous proof",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-lg leading-relaxed text-red-900"
                  >
                    <span className="mono font-bold text-red-600">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
