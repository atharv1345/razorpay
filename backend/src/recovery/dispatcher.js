/**
 * Recovery dispatcher — SRS FR-5, NFR-2
 * Routes by classification; hard guards for terminal + PTP + network outage.
 * Network pause is recovery optimization (avoid doomed retries), NOT fraud detection.
 */
import { payments, actionLog } from '../db/queries.js';
import { networkEvents } from '../db/queries.js';
import { retryTransient } from './retryTransient.js';
import { sendPaymentLink } from './sendPaymentLink.js';
import { retryMandate } from './retryMandate.js';

const TERMINAL = new Set(['recovered', 'refunded', 'exhausted']);

export async function dispatchPayment(payment, ctx = {}) {
  try {
    const fresh = payments.getById(payment.payment_id) || payment;

    if (TERMINAL.has(fresh.status)) {
      actionLog.insert({
        payment_id: fresh.payment_id,
        action_type: 'skipped_terminal_state',
        justification: `Hard guard: status='${fresh.status}' — no further recovery actions`,
        outcome: 'skipped_terminal_state',
        budget_window_id: ctx.budgetWindowId,
      });
      return { skipped: true, reason: 'terminal' };
    }

    if (fresh.status === 'promise_to_pay') {
      const due = fresh.promised_date ? new Date(fresh.promised_date) : null;
      if (due && due > new Date()) {
        actionLog.insert({
          payment_id: fresh.payment_id,
          action_type: 'skipped_ptp',
          justification: `PTP active until ${fresh.promised_date} — nudges suppressed`,
          outcome: 'skipped_ptp',
          budget_window_id: ctx.budgetWindowId,
        });
        return { skipped: true, reason: 'ptp' };
      }
    }

    // Network Intelligence: pause TRANSIENT retries / CARD_ISSUE links during gateway outage
    if (
      (fresh.classification === 'TRANSIENT' || fresh.classification === 'CARD_ISSUE') &&
      fresh.bank_gateway
    ) {
      const active = networkEvents.activeFlag(fresh.bank_gateway);
      if (active) {
        actionLog.insert({
          payment_id: fresh.payment_id,
          action_type: 'paused_network_outage',
          justification: `Paused: ${fresh.bank_gateway} outage (network_event #${active.event_id}) — avoid wasting retry budget on doomed payments`,
          outcome: 'paused_network_outage',
          budget_window_id: ctx.budgetWindowId,
        });
        return { skipped: true, reason: 'network_outage' };
      }
    }

    switch (fresh.classification) {
      case 'TRANSIENT':
        return await retryTransient(fresh, ctx);
      case 'CARD_ISSUE':
        return await sendPaymentLink(fresh, ctx);
      case 'MANDATE_ISSUE':
        return await retryMandate(fresh, ctx);
      default:
        actionLog.insert({
          payment_id: fresh.payment_id,
          action_type: 'skipped_unknown',
          justification: `Unknown classification '${fresh.classification}' — skipped`,
          outcome: 'error',
          budget_window_id: ctx.budgetWindowId,
        });
        return { skipped: true, reason: 'unknown' };
    }
  } catch (err) {
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'dispatcher_error',
      justification: `Executor error: ${err.message} — continuing batch`,
      outcome: 'error',
      budget_window_id: ctx.budgetWindowId,
    });
    return { error: true, message: err.message };
  }
}

export default dispatchPayment;
