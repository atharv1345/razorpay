export function MetricsBar({ metrics, loading }) {
  const rateByAmount = metrics?.recoveryRateByAmount ?? metrics?.recoveryRate ?? 0;
  const rateByCount = metrics?.recoveryRateByCount ?? 0;

  const cards = [
    {
      label: 'At Risk',
      value: metrics ? `₹${metrics.atRiskAmount.toLocaleString('en-IN')}` : '—',
    },
    {
      label: 'Recovered',
      value: metrics ? `₹${metrics.recoveredAmount.toLocaleString('en-IN')}` : '—',
      accent: true,
    },
    {
      label: 'Recovery Rate',
      value: metrics ? `${rateByAmount}%` : '—',
      sub: metrics ? `by ₹ · ${rateByCount}% by count` : null,
      title: 'Recovered ₹ ÷ (At Risk ₹ + Recovered ₹)',
    },
    {
      label: 'Avg Time',
      value: metrics ? `${metrics.avgTimeHours || 0}h` : '—',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="panel px-4 py-3" title={c.title}>
          <div className="text-xs uppercase tracking-wider text-slate-500">{c.label}</div>
          {loading ? (
            <div className="skeleton mt-2 h-8 w-24" />
          ) : (
            <>
              <div
                className={`mt-1 font-display text-2xl font-semibold ${
                  c.accent ? 'text-mint-400' : 'text-white'
                }`}
              >
                {c.value}
              </div>
              {c.sub && <div className="mt-0.5 text-[10px] text-slate-500">{c.sub}</div>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default MetricsBar;
