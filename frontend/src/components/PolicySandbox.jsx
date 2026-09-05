import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/** Interactive Policy Sandbox — SRS FR-11. Projection only until Run. */
export function PolicySandbox({ onRun }) {
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [budget, setBudget] = useState(20);
  const [projection, setProjection] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const p = await api.sandbox(aggressiveness, budget);
        setProjection(p);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [aggressiveness, budget]);

  return (
    <div className="panel border-amber-glow/20 p-4">
      <h3 className="font-display text-lg font-semibold text-amber-glow">
        Policy Sandbox
      </h3>
      <p className="mb-3 text-sm text-slate-400">
        Live Projection — not yet executed
      </p>

      <label className="block text-xs text-slate-500">
        Aggressiveness (gentle ↔ aggressive)
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={aggressiveness}
          onChange={(e) => setAggressiveness(Number(e.target.value))}
          className="mt-1 w-full accent-amber-glow"
        />
      </label>

      <label className="mt-3 block text-xs text-slate-500">
        Budget per window: {budget}
        <input
          type="range"
          min="10"
          max="50"
          step="1"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="mt-1 w-full accent-amber-glow"
        />
      </label>

      {projection && (
        <div className="mt-4 rounded-lg border border-amber-glow/30 bg-amber-glow/5 p-3 text-sm">
          <p>
            At this setting:{' '}
            <span className="text-amber-glow">
              ₹{projection.projectedRecoveredAmount.toLocaleString('en-IN')}
            </span>{' '}
            recoverable, {projection.projectedActionsUsed} messages, fatigue score{' '}
            {projection.estimatedFatigueScore}
          </p>
        </div>
      )}

      <button
        className="mt-4 w-full rounded-lg bg-amber-glow/90 py-2 font-medium text-ink-950 hover:bg-amber-glow"
        onClick={() => onRun?.({ aggressiveness, budget })}
      >
        Run with these settings
      </button>
    </div>
  );
}

export default PolicySandbox;
