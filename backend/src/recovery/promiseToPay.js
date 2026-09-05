/**
 * Promise-to-pay tracker — SRS FR-6
 */
import { payments, actionLog } from '../db/queries.js';

const INTENT_PATTERNS = ['kal', 'tomorrow', 'pay later', 'next week', 'will pay'];

export function detectPromiseIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return INTENT_PATTERNS.some((p) => lower.includes(p));
}

function parsePromisedDate(text) {
  const lower = (text || '').toLowerCase();
  const d = new Date();
  if (lower.includes('next week')) {
    d.setDate(d.getDate() + 7);
  } else if (lower.includes('kal') || lower.includes('tomorrow')) {
    d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() + 1); // default +1 day
  }
  d.setHours(11, 0, 0, 0);
  return d;
}

export function recordPromise(payment_id, promisedDateText) {
  const promised = parsePromisedDate(promisedDateText);
  payments.updateStatus(payment_id, 'promise_to_pay', {
    promised_date: promised.toISOString(),
    next_attempt_at: promised.toISOString(),
  });
  actionLog.insert({
    payment_id,
    action_type: 'scheduled_followup',
    justification: `PTP detected from reply "${promisedDateText}" → follow-up scheduled for ${promised.toISOString()}; nudges suppressed until then`,
    outcome: 'promise_to_pay',
  });
  return { payment_id, promised_date: promised.toISOString() };
}

export default { detectPromiseIntent, recordPromise };
