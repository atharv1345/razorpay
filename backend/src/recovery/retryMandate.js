import config from '../config.js';
import { payments, actionLog, recoveryOutcomes } from '../db/queries.js';

export async function retryMandate(payment, ctx = {}) {
  const attempts = (payment.attempts_made || 0) + 1;

  if (attempts > config.MAX_RETRY_ATTEMPTS) {
    payments.updateStatus(payment.payment_id, 'exhausted', { attempts_made: attempts - 1 });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'mandate_retry',
      justification: `Mandate retries capped at ${config.MAX_RETRY_ATTEMPTS}`,
      outcome: 'exhausted',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, exhausted: true };
  }

  const recovered = Math.random() < 0.28;

  if (recovered) {
    payments.updateStatus(payment.payment_id, 'recovered', { attempts_made: attempts });
    recoveryOutcomes.upsert({
      payment_id: payment.payment_id,
      recovered: true,
      recovered_amount: payment.amount,
      recovered_at: new Date().toISOString(),
      tactic_used: 'mandate_retry',
      attempts_made: attempts,
    });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'mandate_retry',
      justification: `Mandate re-authorization attempt #${attempts} succeeded`,
      outcome: 'recovered',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: true };
  }

  if (attempts >= config.MAX_RETRY_ATTEMPTS) {
    payments.updateStatus(payment.payment_id, 'exhausted', { attempts_made: attempts });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'mandate_retry',
      justification: `Mandate retry #${attempts} failed — exhausted`,
      outcome: 'exhausted',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, exhausted: true };
  }

  payments.updateStatus(payment.payment_id, 'retrying', { attempts_made: attempts });
  actionLog.insert({
    payment_id: payment.payment_id,
    action_type: 'mandate_retry',
    justification: `Mandate retry #${attempts} failed — will retry within allowed window`,
    outcome: 'retry_scheduled',
    budget_window_id: ctx.budgetWindowId,
  });
  return { recovered: false };
}

export default retryMandate;
