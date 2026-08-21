"use client";

/**
 * University (issuer) portal.
 *
 * Load a cohort, commit each credential, build the tree, publish the root,
 * hand out bundles, revoke when necessary.
 *
 * Note what leaves this screen over the network: a root, a semester label, a
 * leaf count, a depth. The students array — names, roll numbers, CGPAs — never
 * goes anywhere but React state and the files the registrar downloads.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  buildBundle,
  degreeName,
  issueCredential,
  parseStudentsCsv,
  type IssuedCredential,
  type StudentRecord,
} from "@/lib/credential";
import { buildMerkleTree, getMerkleProof, type MerkleTree } from "@/lib/merkle";
import { toHex } from "@/lib/poseidon";
import { publishRoot, revokeLeaf, type BatchRecord } from "@/lib/chain";
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Hash,
  HashDisplay,
  JsonBlock,
  PortalHeader,
  Section,
} from "@/components/ui";

const ACCENT = "university" as const;

interface BuiltBatch {
  tree: MerkleTree;
  issued: IssuedCredential[];
  root: string;
}

export function UniversityPortal({ sampleCsv }: { sampleCsv: string }) {
  const [students, setStudents] = useState<StudentRecord[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [batch, setBatch] = useState<BuiltBatch | null>(null);
  const [semesterId, setSemesterId] = useState("2027-SPRING");
  const [published, setPublished] = useState<BatchRecord | null>(null);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "build" | "publish">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* -- Section A ---------------------------------------------------- */

  const loadCsv = useCallback((text: string, label: string) => {
    try {
      const parsed = parseStudentsCsv(text);
      setStudents(parsed);
      setSource(label);
      setBatch(null);
      setPublished(null);
      setPublishNote(null);
      setRevoked({});
      setError(null);
    } catch (err: any) {
      setError(err.message);
      setStudents(null);
    }
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    loadCsv(await file.text(), file.name);
  };

  /* -- Section B ---------------------------------------------------- */

  const buildTree = () => {
    if (!students) return;
    setBusy("build");
    setError(null);
    try {
      // A fresh 256-bit blinding factor per student, then the leaf commitment.
      const issued = students.map((student, index) =>
        issueCredential(student, index),
      );
      const tree = buildMerkleTree(issued.map((credential) => credential.leaf));
      setBatch({ tree, issued, root: toHex(tree.root) });
      setPublished(null);
      setPublishNote(null);
      setRevoked({});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  /* -- Section C ---------------------------------------------------- */

  const publishBody = useMemo(() => {
    if (!batch) return null;
    return {
      root: batch.root,
      semesterId,
      leafCount: batch.tree.leafCount,
      depth: batch.tree.depth,
    };
  }, [batch, semesterId]);

  const publish = async () => {
    if (!publishBody) return;
    setBusy("publish");
    setError(null);
    try {
      const { batch: record, alreadyPublished } = await publishRoot(publishBody);
      setPublished(record);
      setPublishNote(
        alreadyPublished
          ? "This root was already on chain — showing the existing record rather than publishing a duplicate."
          : null,
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  /* -- Section D ---------------------------------------------------- */

  const bundleFor = useCallback(
    (credential: IssuedCredential) => {
      if (!batch) return null;
      const { pathElements, pathIndices } = getMerkleProof(
        batch.tree,
        credential.leafIndex,
      );
      return buildBundle({
        issued: credential,
        semesterId: published?.semesterId ?? semesterId,
        root: batch.root,
        depth: batch.tree.depth,
        leafCount: batch.tree.leafCount,
        pathElements,
        pathIndices,
      });
    },
    [batch, published, semesterId],
  );

  const download = useCallback(
    (credential: IssuedCredential) => {
      const bundle = bundleFor(credential);
      if (!bundle) return;
      // Roll numbers contain "/", which is not valid in a filename.
      const safeRoll = credential.rollNumber.replace(/[^A-Za-z0-9._-]/g, "-");
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `credential-${safeRoll}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    [bundleFor],
  );

  const downloadAll = async () => {
    if (!batch) return;
    for (const credential of batch.issued) {
      download(credential);
      // Stagger so the browser does not collapse the burst into one download.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };

  /* -- Section E ---------------------------------------------------- */

  const revoke = async (credential: IssuedCredential) => {
    if (!published || !batch) return;
    setError(null);
    try {
      const record = await revokeLeaf({
        leaf: credential.leaf,
        root: batch.root,
        semesterId: published.semesterId,
        reason: `Revoked by registrar (${credential.rollNumber})`,
      });
      setRevoked((prev) => ({ ...prev, [credential.leaf]: record.revokedAt }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  /* ----------------------------------------------------------------- */

  return (
    <div>
      <PortalHeader
        accent={ACCENT}
        eyebrow="Issuer"
        title="University portal"
        description="Birla Institute of Technology, Mesra — registrar's console. Commit a graduating batch, publish one Merkle root to the chain, and distribute credential bundles privately."
      />

      {error ? (
        <div className="mb-6">
          <Callout tone="danger" title="Something went wrong">
            {error}
          </Callout>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- A */}
      <Section
        accent={ACCENT}
        step="A"
        title="Load students"
        description="Intake CSV: name, rollNumber, identityCommitment, cgpa, degreeCode, year."
        aside={
          students ? (
            <span className="rounded-md bg-university-100 px-3 py-1.5 text-base font-bold text-university-900">
              {students.length} students &middot; {source}
            </span>
          ) : null
        }
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button
            accent={ACCENT}
            onClick={() => loadCsv(sampleCsv, "sample-students.csv")}
            disabled={!sampleCsv}
          >
            Load sample data
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <Button
            accent={ACCENT}
            variant="outline"
            onClick={() => fileInput.current?.click()}
          >
            Upload CSV
          </Button>
          {students ? (
            <Button
              variant="outline"
              onClick={() => {
                setStudents(null);
                setBatch(null);
                setPublished(null);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {!students ? (
          <EmptyState>
            No cohort loaded. Click <strong>Load sample data</strong> for the 20
            seed students.
          </EmptyState>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Roll number</th>
                  <th>Programme</th>
                  <th>Year</th>
                  <th>CGPA</th>
                  <th>Identity commitment</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, index) => (
                  <tr key={student.rollNumber}>
                    <td className="mono text-ink-faint">{index}</td>
                    <td className="font-semibold">{student.name}</td>
                    <td className="mono">{student.rollNumber}</td>
                    <td>{degreeName(student.degreeCode)}</td>
                    <td className="mono">{student.year}</td>
                    <td
                      className={`mono font-bold ${
                        student.cgpa >= 8 ? "text-student-600" : "text-red-600"
                      }`}
                    >
                      {student.cgpa.toFixed(2)}
                    </td>
                    <td>
                      <Hash value={student.identityCommitment} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------- B */}
      <Section
        accent={ACCENT}
        step="B"
        title="Build the batch"
        description="Draw a fresh 256-bit blinding factor r per student, commit each credential to a leaf, and build the tree. Empty slots are padded with Poseidon of a fixed dummy — never with zero."
      >
        <div className="mb-5">
          <Button
            accent={ACCENT}
            onClick={buildTree}
            disabled={!students}
            loading={busy === "build"}
          >
            Build Merkle Tree
          </Button>
        </div>

        {!batch ? (
          <EmptyState>No tree built yet.</EmptyState>
        ) : (
          <div className="space-y-5">
            <HashDisplay label="Merkle root" value={batch.root} accent={ACCENT} />

            <div className="grid gap-4 sm:grid-cols-4">
              {[
                ["Tree depth", String(batch.tree.depth)],
                ["Leaf slots", String(batch.tree.leafCount)],
                ["Real credentials", String(batch.tree.realLeafCount)],
                [
                  "Padding leaves",
                  String(batch.tree.leafCount - batch.tree.realLeafCount),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
                    {label}
                  </p>
                  <p className="mono mt-1 text-3xl font-bold text-ink">{value}</p>
                </div>
              ))}
            </div>

            <Callout tone="info">
              Each leaf is{" "}
              <code className="mono">
                Poseidon(identityCommitment, cgpaInt, degreeCode, year,
                institutionId, r)
              </code>
              . Because <code className="mono">r</code> is secret and unique per
              student, a published leaf cannot be brute-forced back into a
              credential.
            </Callout>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------- C */}
      <Section
        accent={ACCENT}
        step="C"
        title="Publish"
        description="One root goes on chain for the whole cohort."
      >
        <div className="mb-5 flex flex-wrap items-end gap-4">
          <div className="w-64">
            <Field label="Semester ID">
              <input
                className="input mono"
                value={semesterId}
                onChange={(event) => setSemesterId(event.target.value)}
                placeholder="2027-SPRING"
              />
            </Field>
          </div>
          <Button
            accent={ACCENT}
            onClick={publish}
            disabled={!batch || !semesterId.trim()}
            loading={busy === "publish"}
          >
            Publish to Blockchain
          </Button>
        </div>

        {publishBody ? (
          <div className="mb-5">
            <p className="label mb-2">Exact request body sent to the chain</p>
            <JsonBlock value={publishBody} maxHeight="12rem" />
            <p className="mt-2 text-sm text-ink-faint">
              Four fields. No name, roll number, CGPA, leaf or blinding factor.
              The API route rejects any other field outright.
            </p>
          </div>
        ) : null}

        {published ? (
          <Callout tone="success" title="Published on chain">
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="font-semibold">Root</dt>
              <dd>
                <Hash value={published.root} lead={12} tail={8} />
              </dd>
              <dt className="font-semibold">Semester</dt>
              <dd className="mono">{published.semesterId}</dd>
              <dt className="font-semibold">Issuer</dt>
              <dd className="mono">{published.issuerId}</dd>
              <dt className="font-semibold">Leaves</dt>
              <dd className="mono">{published.leafCount}</dd>
              <dt className="font-semibold">Timestamp</dt>
              <dd className="mono">
                {new Date(published.timestamp).toLocaleString()}
              </dd>
              <dt className="font-semibold">Signature</dt>
              <dd className="flex items-center gap-2">
                <Hash value={published.signature} />
                <span className="text-sm text-employer-700">
                  placeholder &mdash; not verified in this demo
                </span>
              </dd>
            </dl>
          </Callout>
        ) : null}
        {publishNote ? (
          <div className="mt-3">
            <Callout tone="warning">{publishNote}</Callout>
          </div>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- D */}
      <Section
        accent={ACCENT}
        step="D"
        title="Distribute credentials"
        description="Each bundle carries the credential fields, the blinding factor r, the leaf index and the Merkle path. Handed over privately — none of it is on chain."
        aside={
          batch ? (
            <Button accent={ACCENT} variant="outline" onClick={downloadAll}>
              Download All ({batch.issued.length})
            </Button>
          ) : null
        }
      >
        {!batch ? (
          <EmptyState>Build the tree first.</EmptyState>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>Leaf #</th>
                  <th>Name</th>
                  <th>Roll number</th>
                  <th>CGPA</th>
                  <th>Leaf commitment</th>
                  <th className="text-right">Bundle</th>
                </tr>
              </thead>
              <tbody>
                {batch.issued.map((credential) => (
                  <tr key={credential.leaf}>
                    <td className="mono text-ink-faint">
                      {credential.leafIndex}
                    </td>
                    <td className="font-semibold">{credential.name}</td>
                    <td className="mono">{credential.rollNumber}</td>
                    <td
                      className={`mono font-bold ${
                        credential.cgpa >= 8
                          ? "text-student-600"
                          : "text-red-600"
                      }`}
                    >
                      {credential.cgpa.toFixed(2)}
                    </td>
                    <td>
                      <Hash value={credential.leaf} />
                    </td>
                    <td className="text-right">
                      <Button
                        accent={ACCENT}
                        variant="outline"
                        className="!px-3 !py-1.5 !text-sm"
                        onClick={() => download(credential)}
                      >
                        Download Bundle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------- E */}
      <Section
        accent={ACCENT}
        step="E"
        title="Revocation"
        description="Revoking publishes the leaf hash to the on-chain revocation list. A leaf reveals nothing on its own, but it is enough to invalidate that credential."
      >
        {!batch ? (
          <EmptyState>Build the tree first.</EmptyState>
        ) : !published ? (
          <Callout tone="warning">
            Publish the batch before revoking — the chain will not accept a
            revocation against an unpublished root.
          </Callout>
        ) : (
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>Roll number</th>
                  <th>Name</th>
                  <th>Leaf</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {batch.issued.map((credential) => {
                  const revokedAt = revoked[credential.leaf];
                  return (
                    <tr key={credential.leaf}>
                      <td className="mono">{credential.rollNumber}</td>
                      <td className="font-semibold">{credential.name}</td>
                      <td>
                        <Hash value={credential.leaf} />
                      </td>
                      <td>
                        {revokedAt ? (
                          <span className="rounded bg-red-100 px-2 py-1 text-sm font-bold text-red-700">
                            Revoked {new Date(revokedAt).toLocaleTimeString()}
                          </span>
                        ) : (
                          <span className="rounded bg-student-100 px-2 py-1 text-sm font-bold text-student-700">
                            Valid
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <Button
                          variant="outline"
                          className="!px-3 !py-1.5 !text-sm !border-red-300 !bg-red-50 !text-red-700"
                          disabled={Boolean(revokedAt)}
                          onClick={() => revoke(credential)}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
