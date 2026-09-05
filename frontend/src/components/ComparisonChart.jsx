import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

/**
 * Dual Y-axis: ₹ Recovered (left) vs Actions used (right).
 * Shared single-scale charts hide Actions bars when Recovered is ~1000× larger.
 */
export function ComparisonChart({ naive, optimized, phase, loading }) {
  const data = [
    {
      mode: 'Naive',
      recovered: naive?.totalRecoveredAmount ?? 0,
      actions: naive?.actionsUsed ?? 0,
    },
    {
      mode: 'Optimized',
      recovered: optimized?.totalRecoveredAmount ?? 0,
      actions: optimized?.actionsUsed ?? 0,
    },
  ];

  const naiveEff =
    naive?.actionsUsed > 0
      ? Math.round(naive.totalRecoveredAmount / naive.actionsUsed)
      : 0;
  const optEff =
    optimized?.actionsUsed > 0
      ? Math.round(optimized.totalRecoveredAmount / optimized.actionsUsed)
      : 0;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold">Naive vs Optimized</h3>
          <p className="text-sm text-slate-400">
            Same batch — FIFO vs expected-value triage under budget
          </p>
        </div>
        <span className="rounded-md bg-ink-700 px-2 py-1 font-mono text-xs text-slate-300">
          {phase || 'idle'}
        </span>
      </div>

      {loading && !naive && !optimized ? (
        <div className="skeleton h-56 w-full" />
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={8} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2438" />
              <XAxis dataKey="mode" stroke="#94a3b8" fontSize={12} />
              <YAxis
                yAxisId="left"
                stroke="#94a3b8"
                fontSize={11}
                tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#64748b"
                fontSize={11}
                allowDecimals={false}
                label={{
                  value: 'Actions',
                  angle: 90,
                  position: 'insideRight',
                  fill: '#64748b',
                  fontSize: 10,
                }}
              />
              <Tooltip
                contentStyle={{
                  background: '#121a2b',
                  border: '1px solid #334155',
                  borderRadius: 8,
                }}
                formatter={(value, name) =>
                  name === '₹ Recovered'
                    ? [`₹${Number(value).toLocaleString('en-IN')}`, name]
                    : [value, name]
                }
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="recovered"
                name="₹ Recovered"
                fill="#3dffa8"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="actions"
                name="Actions used"
                fill="#64748b"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {(naive || optimized) && (
        <p className="mt-3 text-sm text-slate-300">
          Yield per action:{' '}
          <span className="text-slate-400">Naive ₹{naiveEff}</span>
          {' · '}
          <span className="text-mint-400">Optimized ₹{optEff}</span>
          {' · '}
          <span className="text-xs text-slate-500">
            4 bars: Recovered + Actions × Naive + Optimized
          </span>
        </p>
      )}
    </div>
  );
}

export default ComparisonChart;
