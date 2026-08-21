"use client";

/**
 * Blockchain Explorer — live view of the simulated ledger.
 *
 * Everything shown here is public by construction: roots, leaf counts,
 * revoked leaf hashes. Nothing on this panel can be turned back into a
 * student's credential.
 */

import { useCallback, useEffect, useState } from "react";

import {
  computeRevocationRoot,
  fetchChainState,
  type ChainState,
} from "@/lib/chain";
import { Button, Callout, EmptyState, Hash } from "@/components/ui";

export function ChainExplorer() {
  const [chain, setChain] = useState<ChainState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setChain(await fetchChainState());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="card">
      <div className="card-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink">Blockchain Explorer</h2>
          <p className="mt-1 text-base text-ink-soft">
            The simulated ledger at{" "}
            <code className="mono rounded bg-slate-100 px-1.5 py-0.5">
              data/chain.json
            </code>
            . Public data only — roots, not credentials.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} loading={loading}>
          Refresh
        </Button>
      </div>

      <div className="card-body space-y-6">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <div>
          <h3 className="mb-3 text-base font-bold uppercase tracking-wide text-ink-faint">
            Issuer registry
          </h3>
          {!chain || chain.issuerRegistry.length === 0 ? (
            <EmptyState>No registered issuers.</EmptyState>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Institution</th>
                  <th>Public key</th>
                </tr>
              </thead>
              <tbody>
                {chain.issuerRegistry.map((issuer) => (
                  <tr key={issuer.id}>
                    <td className="mono font-semibold">{issuer.id}</td>
                    <td>{issuer.name}</td>
                    <td>
                      <Hash value={issuer.publicKey} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-base font-bold uppercase tracking-wide text-ink-faint">
            Published batches{" "}
            {chain ? (
              <span className="text-ink-soft">({chain.batches.length})</span>
            ) : null}
          </h3>
          {!chain || chain.batches.length === 0 ? (
            <EmptyState>
              No batches published yet. Build and publish one from the university
              portal.
            </EmptyState>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Merkle root</th>
                  <th>Semester</th>
                  <th>Issuer</th>
                  <th>Leaves</th>
                  <th>Depth</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {[...chain.batches].reverse().map((batch) => (
                  <tr key={batch.root}>
                    <td>
                      <Hash value={batch.root} lead={10} tail={6} />
                    </td>
                    <td className="font-semibold">{batch.semesterId}</td>
                    <td>{batch.issuerId}</td>
                    <td className="mono">{batch.leafCount}</td>
                    <td className="mono">{batch.depth}</td>
                    <td className="text-ink-soft">
                      {new Date(batch.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-base font-bold uppercase tracking-wide text-ink-faint">
            Revocation list{" "}
            {chain ? (
              <span className="text-ink-soft">({chain.revoked.length})</span>
            ) : null}
          </h3>
          {!chain || chain.revoked.length === 0 ? (
            <EmptyState>Nothing revoked.</EmptyState>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Revoked leaf</th>
                  <th>Batch</th>
                  <th>Reason</th>
                  <th>Revoked at</th>
                </tr>
              </thead>
              <tbody>
                {[...chain.revoked].reverse().map((entry) => (
                  <tr key={entry.leaf}>
                    <td>
                      <Hash value={entry.leaf} lead={10} tail={6} />
                    </td>
                    <td className="font-semibold">{entry.semesterId}</td>
                    <td>{entry.reason}</td>
                    <td className="text-ink-soft">
                      {new Date(entry.revokedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {chain ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-sm font-bold uppercase tracking-wide text-ink-faint">
              Revocation accumulator
            </span>
            <Hash value={computeRevocationRoot(chain.revoked)} lead={10} tail={6} />
            <span className="text-sm text-ink-faint">
              Proofs commit to this value to show non-revocation without
              revealing which leaf they hold.
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
