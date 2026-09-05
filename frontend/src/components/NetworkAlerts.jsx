/**
 * Network Alerts — pause/resume recovery during bank/gateway outages.
 * Explicitly NOT fraud detection (SRS §1.2).
 */
export function NetworkAlerts({ events, onDetect, onResume }) {
  const byBank = new Map();
  for (const e of events || []) {
    const prev = byBank.get(e.bank_gateway);
    if (!prev || e.event_id > prev.event_id) byBank.set(e.bank_gateway, e);
  }
  const latest = [...byBank.values()];
  const active = latest.filter((e) => e.status === 'flagged');
  const resumed = latest.filter((e) => e.status === 'resumed');

  return (
    <div className="panel border-coral-alert/30 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold text-coral-alert">
            Network Alerts
          </h3>
          <p className="text-sm text-slate-400">
            Pause doomed retries during bank/gateway outages — recovery optimization only
          </p>
        </div>
        <button
          onClick={onDetect}
          className="rounded-lg bg-coral-alert/15 px-3 py-1.5 text-sm text-coral-alert hover:bg-coral-alert/25"
        >
          Scan for outages
        </button>
      </div>

      <p className="mb-3 rounded-md border border-dashed border-slate-600 px-2 py-1 text-[11px] text-slate-500">
        (Simulated multi-merchant data)
      </p>

      <div className="space-y-3">
        {active.map((e) => (
          <div
            key={`flagged-${e.bank_gateway}`}
            className="rounded-lg border border-coral-alert/40 bg-coral-alert/10 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-coral-alert">
                {e.bank_gateway} · paused
              </span>
              <span className="font-mono text-xs">{e.failure_rate_delta}x baseline</span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              {(e.affected_merchants || []).length} merchants affected
            </p>
            <p className="mt-2 text-xs italic text-slate-400">{e.explanation}</p>
            <button
              className="mt-2 text-xs text-mint-400 underline"
              onClick={() => onResume?.(e.bank_gateway)}
            >
              Demo: resume when rate normalizes
            </button>
          </div>
        ))}

        {resumed.map((e) => (
          <div
            key={`resumed-${e.bank_gateway}`}
            className="rounded-lg border border-mint-500/30 bg-mint-500/5 p-3"
          >
            <span className="font-display text-sm text-mint-400">
              {e.bank_gateway} · resumed
            </span>
            <p className="mt-1 text-xs text-slate-400">{e.justification}</p>
          </div>
        ))}

        {!active.length && !resumed.length && (
          <p className="text-sm text-slate-500">
            No outages flagged. Seed demo data, then scan.
          </p>
        )}
      </div>
    </div>
  );
}

export default NetworkAlerts;
