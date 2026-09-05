import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import MetricsBar from './components/MetricsBar';
import ComparisonChart from './components/ComparisonChart';
import ActionFeed from './components/ActionFeed';
import AuditTable from './components/AuditTable';
import InsightsPanel from './components/InsightsPanel';
import NetworkAlerts from './components/NetworkAlerts';
import PolicySandbox from './components/PolicySandbox';
import AtRiskRadar from './components/AtRiskRadar';
import ExplainChat from './components/ExplainChat';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const [health, setHealth] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [compareLoading, setCompareLoading] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [naive, setNaive] = useState(null);
  const [optimized, setOptimized] = useState(null);
  const [actions, setActions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [insights, setInsights] = useState([]);
  const [network, setNetwork] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, a, all, ins, net, h, c, pred] = await Promise.all([
        api.metrics(),
        api.recentActions(),
        api.actions({}),
        api.insights(),
        api.networkEvents(),
        api.health(),
        api.config(),
        api.predictions(),
      ]);
      setMetrics(m);
      setActions(a);
      setAudit(all);
      setInsights(ins);
      setNetwork(net);
      setHealth(h);
      setCfg(c);
      setPredictions(pred);
    } catch (e) {
      console.error(e);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(async () => {
      try {
        const prog = await api.progress();
        setPhase(prog.phase || 'idle');
        if (prog.naive) setNaive(prog.naive);
        if (prog.optimized) setOptimized(prog.optimized);
        const a = await api.recentActions();
        setActions(a);
        if (prog.phase === 'done') {
          setRunning(false);
          setCompareLoading(false);
          refresh();
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [running, refresh]);

  async function startCompare() {
    setCompareLoading(true);
    setRunning(true);
    setNaive(null);
    setOptimized(null);
    setPhase('starting');
    try {
      await api.startCompare({});
    } catch (e) {
      setCompareLoading(false);
      setRunning(false);
      alert(e.message);
    }
  }

  async function runWithSettings({ aggressiveness, budget }) {
    setCompareLoading(true);
    try {
      await api.runBatch('optimized', { aggressiveness, budget });
      await refresh();
    } finally {
      setCompareLoading(false);
    }
  }

  async function resetDemo() {
    if (!confirm('Refresh demo data?')) return;
    setResetting(true);
    try {
      await api.resetDemo();
      setNaive(null);
      setOptimized(null);
      setPhase('idle');
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 pb-24">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mint-400">
            Razorpay -- AI Revenue Recovery
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
            Recovery Yield Optimizer
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Detect at-risk revenue, prioritize under budget, execute bounded recovery —
            smarter because of platform-scale network signals, not fraud scoring.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startCompare}
            disabled={running}
            className="rounded-lg bg-mint-500 px-4 py-2 font-medium text-ink-950 disabled:opacity-50"
          >
            {running ? 'Comparing…' : 'Run naive vs optimized'}
          </button>
          {cfg?.DEMO_RESET_ENABLED && (
            <button
              onClick={resetDemo}
              disabled={resetting}
              className="rounded-lg border border-amber-glow/40 px-4 py-2 text-sm text-amber-glow disabled:opacity-50"
            >
              {resetting ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </header>

      {health && (
        <p className="mb-4 font-mono text-[11px] text-slate-500">
          API ok · {health.framing} · Payment Links: {cfg?.RAZORPAY_SANDBOX_MODE === 'test' ? 'Razorpay Test Mode' : 'Sandbox Simulation'}
        </p>
      )}

      <ErrorBoundary>
        <MetricsBar metrics={metrics} loading={metricsLoading} />
      </ErrorBoundary>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <ComparisonChart
              naive={naive}
              optimized={optimized}
              phase={phase}
              loading={compareLoading}
            />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <ActionFeed actions={actions} />
        </ErrorBoundary>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorBoundary>
            <AuditTable actions={audit} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary>
          <PolicySandbox onRun={runWithSettings} />
        </ErrorBoundary>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ErrorBoundary>
          <NetworkAlerts
            events={network}
            onDetect={async () => {
              await api.detectNetwork();
              refresh();
            }}
            onResume={async (bank) => {
              await api.resumeBank(bank);
              refresh();
            }}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <InsightsPanel insights={insights} />
        </ErrorBoundary>
        <ErrorBoundary>
          <AtRiskRadar predictions={predictions} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <ExplainChat />
      </ErrorBoundary>
    </div>
  );
}
