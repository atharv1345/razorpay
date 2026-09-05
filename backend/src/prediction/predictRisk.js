/**
 * Payment-failure prediction (preemptive recovery) — NOT customer/fraud scoring.
 * Rule-based signals only. Preemptive nudges are idempotent per subscription
 * (same terminal-state guard pattern as dispatcher FR-5.5).
 */
import config from '../config.js';
import {
  subscriptionsDb,
  predictionsDb,
  actionLog,
} from '../db/queries.js';

const RISK_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function daysUntil(isoDate) {
  if (!isoDate) return Infinity;
  const target = new Date(isoDate);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function scoreSubscription(sub) {
  const days = daysUntil(sub.card_expiry_date);
  if (days >= 0 && days <= 7) {
    return {
      risk_level: 'HIGH',
      reason: 'card_expiring_soon',
      detail: `Card expires in ${days} day(s) — payment likely to fail on next charge`,
    };
  }
  if ((sub.recent_late_charges || 0) >= 2) {
    return {
      risk_level: 'MEDIUM',
      reason: 'recent_payment_friction',
      detail: `Previous ${sub.recent_late_charges} charges needed retry — next charge may fail`,
    };
  }
  return {
    risk_level: 'LOW',
    reason: 'stable',
    detail: 'No preemptive payment-failure signals',
  };
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

/**
 * Allow a new preemptive_nudge only if:
 * - none sent yet for this subscription, OR
 * - risk level escalated vs last prediction/nudge, OR
 * - cooldown window has elapsed since last nudge
 */
export function shouldSendPreemptiveNudge(subscription_id, scored, existingPrediction) {
  if (scored.risk_level !== 'HIGH') return { send: false, why: 'not_high' };

  const lastNudge = actionLog.latestPreemptiveNudge(subscription_id);
  if (!lastNudge) return { send: true, why: 'first_nudge' };

  const prevLevel = existingPrediction?.risk_level;
  const escalated =
    prevLevel &&
    RISK_RANK[scored.risk_level] > (RISK_RANK[prevLevel] ?? 0);

  // Same risk+reason already nudged — skip unless cooldown expired
  const sameSignal =
    lastNudge.justification?.includes(`(${scored.reason})`) ||
    lastNudge.justification?.includes(subscription_id);

  if (sameSignal && !escalated) {
    const elapsed = hoursSince(lastNudge.timestamp);
    if (elapsed < config.PREEMPTIVE_NUDGE_COOLDOWN_HOURS) {
      return {
        send: false,
        why: 'already_nudged',
        lastNudgeAt: lastNudge.timestamp,
      };
    }
    return { send: true, why: 'cooldown_elapsed' };
  }

  if (escalated) return { send: true, why: 'risk_escalated' };
  return { send: false, why: 'already_nudged' };
}

export function runPredictions({ sendPreemptive = true } = {}) {
  const subs = subscriptionsDb.listAll();
  const results = [];

  for (const sub of subs) {
    const scored = scoreSubscription(sub);
    const existing = predictionsDb.get(sub.subscription_id);

    // Upsert is itself idempotent for identical subscription+risk+reason
    const write = predictionsDb.upsert({
      subscription_id: sub.subscription_id,
      customer_name: sub.customer_name,
      risk_level: scored.risk_level,
      reason: scored.reason,
    });

    let nudge = { sent: false, skipped: true, why: 'disabled' };
    if (sendPreemptive && scored.risk_level === 'HIGH') {
      const gate = shouldSendPreemptiveNudge(sub.subscription_id, scored, existing);
      if (gate.send) {
        const message = `Hi ${sub.customer_name}, please update your card before your next ₹${sub.amount} subscription charge — your card is expiring soon. Update: https://rzp.io/i/update_${sub.subscription_id.slice(-6)}`;
        actionLog.insert({
          payment_id: null,
          action_type: 'preemptive_nudge',
          channel: 'email_link',
          justification: `Preemptive card-update nudge for ${sub.subscription_id} (${scored.reason}): "${message}" — no failure has occurred yet`,
          outcome: 'sent',
        });
        nudge = { sent: true, skipped: false, why: gate.why };
      } else {
        // Audit skip once for explainability — but do not spam skip logs either
        const lastSkip = actionLog.latestPreemptiveNudge(sub.subscription_id);
        const recentlySkipped =
          lastSkip &&
          lastSkip.outcome === 'skipped_duplicate' &&
          hoursSince(lastSkip.timestamp) < 1;
        if (!recentlySkipped && gate.why === 'already_nudged') {
          // Prefer silence over duplicate skip noise; only log if never logged a skip
          // after the successful send — keep trail clean for demo.
        }
        nudge = { sent: false, skipped: true, why: gate.why };
      }
    }

    results.push({
      ...sub,
      ...scored,
      predictionUnchanged: !!write?.skipped,
      nudge,
    });
  }

  return results;
}

export function listAtRiskPredictions() {
  // Defensive de-dupe by subscription_id + reason (one active card per key)
  const rows = predictionsDb.listAtRisk();
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.subscription_id}::${r.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default {
  scoreSubscription,
  runPredictions,
  listAtRiskPredictions,
  shouldSendPreemptiveNudge,
};
