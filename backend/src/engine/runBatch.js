import { buildTriageQueue, priorityScore } from './priorityQueue.js';
import { dispatchPayment } from '../recovery/dispatcher.js';
import { payments, batchProgress, recoveryOutcomes } from '../db/queries.js';
import { detectOutage, checkResume } from '../network/outageDetector.js';
import config from '../config.js';

function summarize(mode, processed, actionsUsed) {
  const outcomes = recoveryOutcomes.listAll().filter((o) => o.recovered);
  const totalRecoveredAmount = outcomes.reduce((s, o) => s + (o.recovered_amount || 0), 0);
  const unresolved = payments.listUnresolved();
  const stillAtRisk = unresolved.reduce((s, p) => s + p.amount, 0);
  return {
    mode,
    totalProcessed: processed,
    totalRecoveredAmount: Math.round(totalRecoveredAmount),
    totalAtRiskAmount: Math.round(stillAtRisk + totalRecoveredAmount),
    recoveryRate:
      processed > 0
        ? Math.round((outcomes.length / Math.max(processed, 1)) * 1000) / 10
        : 0,
    actionsUsed,
    recoveredCount: outcomes.length,
    yieldPerAction:
      actionsUsed > 0 ? Math.round(totalRecoveredAmount / actionsUsed) : 0,
  };
}

/**
 * Run recovery batch — SRS FR-3 / FR-8.2
 * @param {'naive'|'optimized'} mode
 * @param {{ budget?: number, aggressiveness?: number, onProgress?: Function }} opts
 */
export async function runBatch(mode = 'optimized', opts = {}) {
  const budgetWindowId = `${mode}_${Date.now()}`;
  // Network scan is opt-in for batch (demo uses /api/network/detect).
  // Avoid auto-flagging mid-compare so naive vs optimized stays apples-to-apples.
  if (opts.scanNetwork) {
    detectOutage();
    checkResume();
  }

  const queue = buildTriageQueue(mode, {
    budget: opts.budget ?? config.BUDGET_PER_WINDOW,
    aggressiveness: opts.aggressiveness ?? 0.5,
  });

  let actionsUsed = 0;
  let processed = 0;

  for (const payment of queue) {
    const result = await dispatchPayment(payment, { budgetWindowId });
    processed += 1;
    if (!result.skipped) actionsUsed += 1;

    if (opts.onProgress) {
      opts.onProgress(
        summarize(mode, processed, actionsUsed),
        processed,
        queue.length
      );
    }
  }

  return summarize(mode, processed, actionsUsed);
}

/** Reset → naive → capture → reset → optimized → capture (progressive) */
export async function runCompare(opts = {}) {
  batchProgress.set({ phase: 'starting', naive: null, optimized: null });

  payments.resetForCompare();
  batchProgress.set({ phase: 'naive_running', naive: null, optimized: null });

  const naive = await runBatch('naive', {
    ...opts,
    onProgress: (summary) => {
      batchProgress.set({ phase: 'naive_running', naive: summary, optimized: null });
    },
  });

  batchProgress.set({ phase: 'naive_done', naive, optimized: null });

  payments.resetForCompare();
  batchProgress.set({ phase: 'optimized_running', naive, optimized: null });

  const optimized = await runBatch('optimized', {
    budget: opts.budget ?? config.BUDGET_PER_WINDOW,
    aggressiveness: opts.aggressiveness ?? 0.5,
    onProgress: (summary) => {
      batchProgress.set({ phase: 'optimized_running', naive, optimized: summary });
    },
  });

  const result = { naive, optimized, phase: 'done' };
  batchProgress.set(result);
  return result;
}

/** Read-only projection for Policy Sandbox — SRS FR-11 (no action_log writes) */
export function projectSandbox({ aggressiveness = 0.5, budget = 20 } = {}) {
  const unresolved = payments.listUnresolved({ includeSimulated: false });
  const scored = unresolved
    .map((p) => ({ ...p, priority_score: priorityScore(p, aggressiveness) }))
    .sort((a, b) => b.priority_score - a.priority_score);

  const selected = scored.slice(0, budget);
  const projectedRecoveredAmount = selected.reduce((sum, p) => {
    const prior = config.RECOVERY_PRIORS[p.classification] ?? 0.3;
    const adj = Math.min(0.95, prior * (0.7 + aggressiveness * 0.6));
    return sum + adj * p.amount;
  }, 0);

  const projectedActionsUsed = selected.length;
  const totalCustomers = Math.max(unresolved.length, 1);
  const estimatedFatigueScore =
    Math.round(((projectedActionsUsed / totalCustomers) * (0.5 + aggressiveness) * 100) * 10) /
    10;

  return {
    projectedRecoveredAmount: Math.round(projectedRecoveredAmount),
    projectedActionsUsed,
    estimatedFatigueScore,
    aggressiveness,
    budget,
    note: 'Live Projection — not yet executed',
  };
}

export default { runBatch, runCompare, projectSandbox };
