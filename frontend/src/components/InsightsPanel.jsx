export function InsightsPanel({ insights }) {
  const seen = new Set();
  const unique = (insights || []).filter((ins) => {
    const key = ins.pattern_description;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="panel p-4">
      <h3 className="font-display text-lg font-semibold">Leak-to-Fix insights</h3>
      <p className="mb-3 text-sm text-slate-400">
        Stop the leak — not just patch individual failures
      </p>
      <div className="grid gap-3 md:grid-cols-1">
        {unique.map((ins) => (
          <div
            key={ins.pattern_description}
            className="rounded-lg border border-slate-800 bg-ink-800/50 p-3"
          >
            <div className="text-xs text-amber-glow">{ins.affected_count} affected</div>
            <p className="mt-1 text-sm font-medium text-slate-100">
              {ins.pattern_description}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {ins.suggested_fix}
            </p>
          </div>
        ))}
        {!unique.length && (
          <p className="text-sm text-slate-500">Insights appear after seed + classify.</p>
        )}
      </div>
    </div>
  );
}

export default InsightsPanel;
