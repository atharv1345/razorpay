/**
 * At-Risk Radar — predicted payment failures (preemptive).
 * Payment-failure likelihood only — not customer/fraud scoring.
 * De-dupes by subscription_id + reason (same safeguard as Insights / Network Alerts).
 */
export function AtRiskRadar({ predictions }) {
  const seen = new Set();
  const unique = (predictions || []).filter((p) => {
    const key = `${p.subscription_id}::${p.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const badge = (level) =>
    level === 'HIGH'
      ? 'bg-coral-alert/20 text-coral-alert'
      : 'bg-amber-glow/20 text-amber-glow';

  return (
    <div className="panel border-mint-500/20 p-4">
      <h3 className="font-display text-lg font-semibold text-mint-400">At-Risk Radar</h3>
      <p className="mb-1 text-sm text-slate-400">
        Subscriptions likely to fail on the next charge
      </p>
      <p className="mb-3 rounded-md border border-dashed border-mint-500/30 px-2 py-1 text-[11px] text-mint-400/80">
        Predicted — no failure has happened yet
      </p>
      <div className="space-y-2">
        {unique.map((p) => (
          <div
            key={`${p.subscription_id}::${p.reason}`}
            className="rounded-lg border border-slate-800 bg-ink-800/50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{p.customer_name}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge(p.risk_level)}`}>
                {p.risk_level}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500">{p.subscription_id}</p>
            <p className="mt-1 text-xs text-slate-400">{p.reason.replaceAll('_', ' ')}</p>
          </div>
        ))}
        {!unique.length && (
          <p className="text-sm text-slate-500">No elevated payment-failure predictions.</p>
        )}
      </div>
    </div>
  );
}

export default AtRiskRadar;
