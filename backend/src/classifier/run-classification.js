import { payments, actionLog } from '../db/queries.js';
import { classifyFailure } from './classify.js';

/** Classify all unclassified payments and audit each — SRS FR-2 */
export function runClassification() {
  const rows = payments.listAll({ unclassified: true });
  let count = 0;
  for (const p of rows) {
    const { classification, rule } = classifyFailure(p.failure_reason, p.type);
    payments.updateClassification(p.payment_id, classification);
    actionLog.insert({
      payment_id: p.payment_id,
      action_type: 'classify',
      justification: rule,
      outcome: classification,
    });
    count += 1;
  }
  return { classified: count };
}

export default runClassification;
