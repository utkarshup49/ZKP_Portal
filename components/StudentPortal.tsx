"use client";

/**
 * Student (holder) wallet.
 *
 * The credential lives in React state and nowhere else — no localStorage, no
 * server, no API call. Refreshing the page wipes it, which is exactly the
 * property we want to demonstrate: the credential lives on the device.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  buildBundle,
  degreeName,
  describeRequest,
  deriveDemoIdentitySecret,
  formatCgpa,
  intToCgpa,
  issueCredential,
  parseBundle,
  parseStudentsCsv,
  parseVerificationRequest,
  type CredentialBundle,
  type VerificationRequest,
} from "@/lib/credential";
import { buildMerkleTree, getMerkleProof } from "@/lib/merkle";
import { publishRoot } from "@/lib/chain";
import { getPendingRequest, putPendingProof } from "@/lib/handoff";
import {
  generateProof,
  ProofConstraintError,
  proofStepLabels,
  type Proof,
  type ProofStep,
} from "@/lib/prover";
import {
  Button,
  Callout,
  DemoModeBanner,
  EmptyState,
  Hash,
  JsonBlock,
  PortalHeader,
  Section,
  useCopy,
} from "@/components/ui";

const ACCENT = "student" as const;

/** Roll numbers offered by the "Load demo student" shortcut. */
const DEMO_STUDENTS = [
  { roll: "BTECH/27431/23", label: "Aarav Sharma — CGPA 8.34", tone: "pass" },
  { roll: "BTECH/27155/23", label: "Karan Malhotra — CGPA 6.40", tone: "fail" },
] as const;

interface ProofFailure {
  step: number;
  constraint: string;
  message: string;
}

export function StudentPortal({ sampleCsv }: { sampleCsv: string }) {
  /* The credential — React state only. Never persisted. */
  const [bundle, setBundle] = useState<CredentialBundle | null>(null);
  /**
   * DEMO SIMPLIFICATION: the identity secret arrives inside the bundle and is
   * adopted here on import. In a real wallet this value is generated with
   * crypto.getRandomValues at registration — before any credential exists — and
   * only Poseidon(identitySecret, IDENTITY_DOMAIN) is ever sent to the
   * university. The university would never be in a position to ship it.
   */
  const [identitySecret, setIdentitySecret] = useState<string | null>(null);

  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);

  const [requestText, setRequestText] = useState("");
  const [request, setRequest] = useState<VerificationRequest | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [steps, setSteps] = useState<ProofStep[]>([]);
  const [proving, setProving] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [failure, setFailure] = useState<ProofFailure | null>(null);
  const [sentToEmployer, setSentToEmployer] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const { copied: proofCopied, copy: copyProof } = useCopy();

  /* -- Section A: import -------------------------------------------- */

  const adopt = useCallback((next: CredentialBundle) => {
    setBundle(next);
    setIdentitySecret(
      next.secrets.identitySecret ||
        deriveDemoIdentitySecret(next.credential.rollNumber),
    );
    setProof(null);
    setFailure(null);
    setSteps([]);
    setSentToEmployer(false);
    setImportError(null);
  }, []);

  const importText = useCallback(
    (text: string) => {
      try {
        adopt(parseBundle(JSON.parse(text)));
      } catch (err: any) {
        setImportError(err.message);
        setBundle(null);
      }
    },
    [adopt],
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      importText(await file.text());
    },
    [importText],
  );

  /**
   * Shortcut for a live demo: rebuild the sample batch in the browser, publish
   * its root, and adopt one student's bundle. Stands in for having run the
   * university portal's steps A–C first.
   */
  const loadDemoStudent = async (roll: string) => {
    setLoadingDemo(roll);
    setImportError(null);
    try {
      const students = parseStudentsCsv(sampleCsv);
      const issued = students.map((student, index) =>
        issueCredential(student, index),
      );
      const tree = buildMerkleTree(issued.map((credential) => credential.leaf));
      const root = "0x" + tree.root.toString(16).padStart(64, "0");

      await publishRoot({
        root,
        semesterId: "2027-SPRING",
        leafCount: tree.leafCount,
        depth: tree.depth,
      });

      const mine = issued.find((credential) => credential.rollNumber === roll);
      if (!mine) throw new Error(`No sample student with roll number ${roll}`);

      const { pathElements, pathIndices } = getMerkleProof(tree, mine.leafIndex);
      adopt(
        parseBundle(
          buildBundle({
            issued: mine,
            semesterId: "2027-SPRING",
            root,
            depth: tree.depth,
            leafCount: tree.leafCount,
            pathElements,
            pathIndices,
          }),
        ),
      );
    } catch (err: any) {
      setImportError(err.message);
    } finally {
      setLoadingDemo(null);
    }
  };

  /* -- Section C: request ------------------------------------------- */

  const applyRequest = useCallback((text: string) => {
    try {
      const parsed = parseVerificationRequest(JSON.parse(text));
      setRequest(parsed);
      setRequestError(null);
      setProof(null);
      setFailure(null);
      setSteps([]);
      setSentToEmployer(false);
    } catch (err: any) {
      setRequestError(err.message);
      setRequest(null);
    }
  }, []);

  const loadFromEmployerTab = () => {
    const pending = getPendingRequest();
    if (!pending) {
      setRequestError(
        "No pending request found. Generate one on the employer portal and click “Send to student tab”.",
      );
      return;
    }
    const text = JSON.stringify(pending, null, 2);
    setRequestText(text);
    applyRequest(text);
  };

  /* -- Section D: proving ------------------------------------------- */

  const stepLabels = useMemo(
    () => proofStepLabels(bundle?.merkle.pathElements.length ?? 0),
    [bundle],
  );

  const runProof = async () => {
    if (!bundle || !request) return;
    setProving(true);
    setProof(null);
    setFailure(null);
    setSentToEmployer(false);
    setSteps(
      stepLabels.map((label, index) => ({
        index,
        label,
        status: "pending" as const,
      })),
    );

    try {
      const result = await generateProof(bundle, request, {
        stepDelayMs: 260,
        onStep: (step) =>
          setSteps((prev) => {
            const next = [...prev];
            next[step.index] = step;
            return next;
          }),
      });
      setProof(result);
    } catch (err: any) {
      if (err instanceof ProofConstraintError) {
        setFailure({
          step: err.stepIndex,
          constraint: err.constraint,
          message: err.message,
        });
      } else {
        setFailure({ step: -1, constraint: "unknown", message: err.message });
      }
    } finally {
      setProving(false);
    }
  };

  const sendToEmployer = () => {
    if (!proof) return;
    putPendingProof(proof);
    setSentToEmployer(true);
  };

  /* ----------------------------------------------------------------- */

  const credential = bundle?.credential;

  return (
    <div>
      <PortalHeader
        accent={ACCENT}
        eyebrow="Holder"
        title="Student wallet"
        description="Your grade card, held on this device. Read what an employer is asking, produce a proof that answers exactly that question, and nothing more."
      />

      <DemoModeBanner />

      {/* ---------------------------------------------------------- A */}
      <Section
        accent={ACCENT}
        step="A"
        title="Import your credential"
        description="Drop the credential-*.json bundle the university gave you."
      >
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void onFiles(event.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging
              ? "border-student-400 bg-student-50"
              : "border-slate-300 bg-slate-50 hover:border-student-400 hover:bg-student-50"
          }`}
        >
          <p className="text-lg font-semibold text-ink">
            Drop your credential bundle here
          </p>
          <p className="mt-1 text-base text-ink-faint">
            or click to choose a <code className="mono">.json</code> file
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => void onFiles(event.target.files)}
        />

        <div className="mt-5">
          <p className="label mb-2">Or use a shortcut</p>
          <div className="flex flex-wrap gap-3">
            {DEMO_STUDENTS.map((demo) => (
              <Button
                key={demo.roll}
                accent={ACCENT}
                variant={demo.tone === "pass" ? "solid" : "outline"}
                loading={loadingDemo === demo.roll}
                onClick={() => void loadDemoStudent(demo.roll)}
                disabled={!sampleCsv}
              >
                Load demo student &middot; {demo.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-faint">
            The shortcut rebuilds the sample batch in this browser and publishes
            its root, standing in for the university having issued it first.
          </p>
        </div>

        {importError ? (
          <div className="mt-5">
            <Callout tone="danger" title="Could not import that file">
              {importError}
            </Callout>
          </div>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- B */}
      <Section
        accent={ACCENT}
        step="B"
        title="My credential"
        description="Held in memory on this device. Refresh the page and it is gone."
      >
        {!credential || !bundle ? (
          <EmptyState>No credential imported yet.</EmptyState>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border-2 border-student-200 bg-student-50 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-student-700">
                    {bundle.issuer.name}
                  </p>
                  <h3 className="mt-1 text-3xl font-bold text-ink">
                    {credential.name}
                  </h3>
                  <p className="mono mt-1 text-lg text-ink-soft">
                    {credential.rollNumber}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold uppercase tracking-wide text-student-700">
                    CGPA
                  </p>
                  <p className="mono text-5xl font-bold text-student-700">
                    {formatCgpa(credential.cgpaInt)}
                  </p>
                </div>
              </div>

              <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {[
                  ["Programme", degreeName(credential.degreeCode)],
                  ["Year of issue", String(credential.year)],
                  ["Semester batch", bundle.semesterId],
                  ["Leaf index", `${bundle.merkle.leafIndex} of ${bundle.merkle.leafCount}`],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="text-sm font-semibold uppercase tracking-wide text-student-700">
                      {term}
                    </dt>
                    <dd className="text-lg font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 grid gap-3 border-t border-student-200 pt-5 sm:grid-cols-2">
                {[
                  ["Leaf commitment", bundle.merkle.leaf],
                  ["Batch root", bundle.merkle.root],
                  ["Blinding factor r", bundle.secrets.r],
                  ["Identity commitment", credential.identityCommitment],
                ].map(([term, value]) => (
                  <div key={term} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-sm font-semibold uppercase tracking-wide text-student-700">
                      {term}
                    </span>
                    <Hash value={value} />
                  </div>
                ))}
              </div>
            </div>

            <Callout tone="success" title="These values are stored only on this device.">
              They are never sent anywhere. No API route in this app accepts a
              CGPA, a name or a roll number — and refreshing this page clears the
              credential from memory entirely.
            </Callout>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------- C */}
      <Section
        accent={ACCENT}
        step="C"
        title="Verification request"
        description="Paste the JSON an employer sent you, or pull it straight from the employer tab."
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <Button accent={ACCENT} variant="outline" onClick={loadFromEmployerTab}>
            Load from employer tab
          </Button>
          <Button
            accent={ACCENT}
            variant="outline"
            onClick={() => applyRequest(requestText)}
            disabled={!requestText.trim()}
          >
            Parse pasted request
          </Button>
        </div>

        <textarea
          className="input mono h-40 resize-y"
          placeholder='{ "requestId": "...", "threshold": 800, "requiredDegreeCode": 1101, ... }'
          value={requestText}
          onChange={(event) => setRequestText(event.target.value)}
          onBlur={(event) =>
            event.target.value.trim() ? applyRequest(event.target.value) : null
          }
        />

        {requestError ? (
          <div className="mt-4">
            <Callout tone="danger">{requestError}</Callout>
          </div>
        ) : null}

        {request ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border-2 border-student-200 bg-white p-5">
              <p className="text-sm font-bold uppercase tracking-wide text-student-700">
                {request.verifierName} is asking you to prove
              </p>
              <p className="mt-2 text-2xl font-semibold leading-snug text-ink">
                {describeRequest(request)}
              </p>
            </div>

            <dl className="grid gap-x-8 gap-y-2 text-base sm:grid-cols-2">
              <div className="flex gap-3">
                <dt className="w-40 shrink-0 font-semibold text-ink-faint">
                  Threshold
                </dt>
                <dd className="mono">
                  {request.threshold} (CGPA {intToCgpa(request.threshold).toFixed(2)})
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-40 shrink-0 font-semibold text-ink-faint">
                  Degree code
                </dt>
                <dd className="mono">
                  {request.requiredDegreeCode} ({degreeName(request.requiredDegreeCode)})
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-40 shrink-0 font-semibold text-ink-faint">
                  Year range
                </dt>
                <dd className="mono">
                  {request.minYear}&ndash;{request.maxYear}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-40 shrink-0 font-semibold text-ink-faint">
                  Session nonce
                </dt>
                <dd>
                  <Hash value={request.nonce} />
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- D */}
      <Section
        accent={ACCENT}
        step="D"
        title="Generate proof"
        description="Every constraint below is checked for real against your private fields. If one fails, no proof exists to produce."
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button
            accent={ACCENT}
            onClick={runProof}
            disabled={!bundle || !request}
            loading={proving}
          >
            Generate Proof
          </Button>
          {!bundle || !request ? (
            <span className="text-base text-ink-faint">
              Import a credential and load a request first.
            </span>
          ) : null}
        </div>

        {steps.length > 0 ? (
          <ol className="mb-6 space-y-2">
            {steps.map((step) => {
              const icon =
                step.status === "done"
                  ? "✓"
                  : step.status === "failed"
                    ? "✕"
                    : step.status === "running"
                      ? "…"
                      : "○";
              const tone =
                step.status === "done"
                  ? "text-student-600"
                  : step.status === "failed"
                    ? "text-red-600"
                    : step.status === "running"
                      ? "text-ink"
                      : "text-slate-300";
              return (
                <li
                  key={step.index}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 ${
                    step.status === "failed"
                      ? "border-red-300 bg-red-50"
                      : step.status === "done"
                        ? "border-student-200 bg-student-50"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <span className={`mono text-xl font-bold leading-tight ${tone}`}>
                    {icon}
                  </span>
                  <span className="flex-1">
                    <span
                      className={`text-lg font-semibold ${
                        step.status === "pending" ? "text-slate-400" : "text-ink"
                      }`}
                    >
                      {step.label}
                    </span>
                    {step.detail && step.status !== "failed" ? (
                      <span className="mono block text-sm text-ink-faint">
                        {step.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {failure ? (
          <Callout
            tone="danger"
            title={`Proof generation failed — ${failure.constraint} constraint`}
          >
            <p>{failure.message}</p>
            <p className="mt-3 font-semibold">
              This is the system working correctly. There is no proof for a claim
              that is not true, so no amount of retrying will produce one.
            </p>
          </Callout>
        ) : null}

        {proof ? (
          <div className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-lg font-bold text-ink">
                  The proof (what you generated)
                </h3>
                <JsonBlock value={proof} maxHeight="26rem" />
              </div>

              <div>
                <h3 className="mb-2 text-lg font-bold text-ink">
                  What the employer will see
                </h3>
                <div className="rounded-xl border-2 border-student-400 bg-student-50 p-5">
                  <p className="mb-4 text-base font-semibold text-student-900">
                    These five values, plus the revocation accumulator. Nothing
                    else crosses the wire.
                  </p>
                  <dl className="space-y-3">
                    {[
                      ["Root", <Hash key="r" value={proof.publicInputs.root} lead={10} tail={6} />],
                      [
                        "Threshold",
                        <span key="t" className="mono text-lg font-semibold">
                          {proof.publicInputs.threshold}
                        </span>,
                      ],
                      [
                        "Degree code",
                        <span key="d" className="mono text-lg font-semibold">
                          {proof.publicInputs.requiredDegreeCode}
                        </span>,
                      ],
                      ["Nonce", <Hash key="n" value={proof.publicInputs.nonce} lead={10} tail={6} />],
                      [
                        "Nullifier",
                        <Hash key="u" value={proof.publicInputs.nullifier} lead={10} tail={6} />,
                      ],
                      [
                        "Revocation root",
                        <Hash
                          key="v"
                          value={proof.publicInputs.revocationRoot}
                          lead={10}
                          tail={6}
                        />,
                      ],
                    ].map(([term, node]) => (
                      <div key={String(term)} className="flex items-center gap-3">
                        <dt className="w-36 shrink-0 text-sm font-bold uppercase tracking-wide text-student-700">
                          {term}
                        </dt>
                        <dd>{node}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5 border-t-2 border-student-200 pt-4">
                    <p className="text-base font-bold text-student-900">
                      Not in this list:
                    </p>
                    <p className="mt-1 text-base leading-relaxed text-student-900">
                      your CGPA, your name, your roll number, your subject marks,
                      your leaf, your blinding factor, or which of the{" "}
                      {bundle?.merkle.leafCount ?? "N"} leaves under this root is
                      yours.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                accent={ACCENT}
                variant="outline"
                onClick={() => copyProof(JSON.stringify(proof, null, 2))}
              >
                {proofCopied ? "Copied" : "Copy Proof"}
              </Button>
              <Button accent={ACCENT} onClick={sendToEmployer}>
                Send to employer tab
              </Button>
              {sentToEmployer ? (
                <span className="text-base font-semibold text-student-600">
                  Sent. Open the employer portal and click &ldquo;Load from
                  student tab&rdquo;.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
