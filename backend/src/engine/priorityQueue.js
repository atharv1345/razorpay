import config from '../config.js';
import { payments, actionLog, customerHistory } from '../db/queries.js';

/** SRS FR-3 — Expected-Value Triage Queue (+ CLV relationship bonus) */
export function estimatedRecoveryProbability(classification) {
  return config.RECOVERY_PRIORS[classification] ?? 0.3;
}

export function fatiguePenalty() {
  return config.FATIGUE_PENALTY;
}

/** Small additive bonus — amount-at-risk still dominates */
export function relationshipBonus(payment) {
  const hist =
    customerHistory.get(payment.customer_name) || {
      relationship_months: payment.relationship_months || 0,
      total_past_payments: payment.total_past_payments || 1,
    };
  const months = hist.relationship_months || 0;
  const past = hist.total_past_payments || 1;
  // Cap so bonus stays secondary to EV×amount
  const bonus = Math.min(400, months * 8 + past * 2);
  return { bonus, months, past };
}

export function priorityScore(payment, aggressiveness = 0.5) {
  const prior = estimatedRecoveryProbability(payment.classification);
  const adjPrior = Math.min(0.95, prior * (0.7 + aggressiveness * 0.6));
  const { bonus } = relationshipBonus(payment);
  return adjPrior * payment.amount - fatiguePenalty() + bonus;
}

/**
 * @param {'naive'|'optimized'} mode
 * @param {{ budget?: number, aggressiveness?: number, includeSimulated?: boolean }} opts
 */
export function buildTriageQueue(mode = 'optimized', opts = {}) {
  const unresolved = payments.listUnresolved({
    includeSimulated: !!opts.includeSimulated,
  });
  const budget = opts.budget ?? config.BUDGET_PER_WINDOW;
  const aggressiveness = opts.aggressiveness ?? 0.5;

  if (mode === 'naive') {
    return unresolved.map((p) => {
      const score = priorityScore(p, aggressiveness);
      return { ...p, priority_score: score };
    });
  }

  const scored = unresolved
    .map((p) => {
      const { bonus, months, past } = relationshipBonus(p);
      const score = priorityScore(p, aggressiveness);
      payments.updateClassification(p.payment_id, p.classification, score);
      const relNote =
        bonus > 50
          ? ` | prioritized: ${months}-month repeat customer (${past} past payments), relationship bonus +${bonus.toFixed(0)} applied`
          : '';
      actionLog.insert({
        payment_id: p.payment_id,
        action_type: 'priority_score',
        justification: `EV = P(${p.classification})×₹${p.amount} − fatigue ${config.FATIGUE_PENALTY}${
          bonus > 0 ? ` + relationshipBonus ${bonus.toFixed(0)}` : ''
        } = ${score.toFixed(2)}${relNote}`,
        outcome: String(Math.round(score * 100) / 100),
      });
      return { ...p, priority_score: score, relationship_bonus: bonus };
    })
    .sort((a, b) => b.priority_score - a.priority_score);

  return scored.slice(0, budget);
}

export default { priorityScore, buildTriageQueue, estimatedRecoveryProbability, relationshipBonus };
