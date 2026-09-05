export function ActionFeed({ actions }) {
  return (
    <div className="panel flex h-72 flex-col p-4">
      <h3 className="font-display text-lg font-semibold">Live action feed</h3>
      <p className="mb-2 text-xs text-slate-500">Polls every 2s during a run</p>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {(actions || []).map((a) => (
          <div
            key={a.action_id}
            className="rounded-lg border border-slate-800 bg-ink-800/60 px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-mint-400">{a.action_type}</span>
              <span className="font-mono text-[10px] text-slate-500">{a.outcome}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{a.justification}</p>
          </div>
        ))}
        {!actions?.length && (
          <p className="text-sm text-slate-500">No actions yet — run a comparison batch.</p>
        )}
      </div>
    </div>
  );
}

export default ActionFeed;
