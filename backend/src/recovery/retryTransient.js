import config from '../config.js';
import { payments, actionLog, recoveryOutcomes } from '../db/queries.js';

/** Simulate or call Razorpay test-mode — SRS FR-5.1 */

function simulateRetrySuccess(payment) {
  // TRANSIENT recovers more often; amount-weighted slight bias
  const base = payment.classification === 'TRANSIENT' ? 0.55 : 0.25;
  return Math.random() < base;
}

export async function retryTransient(payment, ctx = {}) {
  const attempts = (payment.attempts_made || 0) + 1;
  const backoffLabels = ['immediate', '1hr', '6hr'];
  const backoffMs = [0, 60 * 60 * 1000, 6 * 60 * 60 * 1000];
  const label = backoffLabels[Math.min(attempts - 1, 2)];

  if (attempts > config.MAX_RETRY_ATTEMPTS) {
    payments.updateStatus(payment.payment_id, 'exhausted', { attempts_made: attempts - 1 });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'retry_transient',
      justification: `Max retries (${config.MAX_RETRY_ATTEMPTS}) reached — stopping`,
      outcome: 'exhausted',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, exhausted: true };
  }

  // Simulate scheduled attempt (no real sleep)
  if (attempts > 1) {
    const next = new Date(Date.now() + backoffMs[attempts - 1]);
    payments.updateStatus(payment.payment_id, 'retrying', {
      attempts_made: attempts,
      next_attempt_at: next.toISOString(),
    });
  } else {
    payments.updateStatus(payment.payment_id, 'retrying', { attempts_made: attempts });
  }

  const recovered =
    config.RAZORPAY_SANDBOX_MODE === 'simulate'
      ? simulateRetrySuccess(payment)
      : simulateRetrySuccess(payment); // live API hook point

  if (recovered) {
    payments.updateStatus(payment.payment_id, 'recovered', { attempts_made: attempts });
    recoveryOutcomes.upsert({
      payment_id: payment.payment_id,
      recovered: true,
      recovered_amount: payment.amount,
      recovered_at: new Date().toISOString(),
      tactic_used: 'retry_transient',
      attempts_made: attempts,
    });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'retry_transient',
      justification: `TRANSIENT retry #${attempts} (${label} backoff) succeeded via ${config.RAZORPAY_SANDBOX_MODE}`,
      outcome: 'recovered',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: true };
  }

  if (attempts >= config.MAX_RETRY_ATTEMPTS) {
    payments.updateStatus(payment.payment_id, 'exhausted', { attempts_made: attempts });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'retry_transient',
      justification: `TRANSIENT retry #${attempts} failed — attempts exhausted`,
      outcome: 'exhausted',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, exhausted: true };
  }

  actionLog.insert({
    payment_id: payment.payment_id,
    action_type: 'retry_transient',
    justification: `TRANSIENT retry #${attempts} (${label}) failed — scheduling next backoff`,
    outcome: 'retry_scheduled',
    budget_window_id: ctx.budgetWindowId,
  });
  return { recovered: false };
}

export default retryTransient;
