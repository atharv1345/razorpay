/**
 * Razorpay webhook handler — SRS §7.1 / FR-1
 * Signature must be verified before any payload processing.
 */
import crypto from 'crypto';
import { payments, actionLog, recoveryOutcomes } from '../db/queries.js';
import { classifyFailure } from '../classifier/classify.js';

/**
 * Returns true only when HMAC matches.
 * Missing secret/signature/body → false (never silently accept).
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature || rawBody == null || rawBody === '') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function upsertFailedPayment(payload, type) {
  const entity = payload.payment?.entity || payload.payload?.payment?.entity || payload;
  const payment_id = entity.id || `wh_${Date.now()}`;
  const amount = (entity.amount || 0) / 100;
  const failure_reason =
    entity.error_reason || entity.error_code || entity.failure_reason || 'network_error';
  const customer_name =
    entity.notes?.customer_name || entity.email || 'Webhook Customer';
  const bank_gateway = entity.bank || entity.acquirer_data?.bank || 'HDFC';

  const { classification, rule } = classifyFailure(
    normalizeReason(failure_reason),
    type
  );

  payments.insert({
    payment_id,
    merchant_id: 'merchant_demo_1',
    customer_name,
    amount: amount || 499,
    currency: entity.currency || 'INR',
    status: 'failed',
    failure_reason: normalizeReason(failure_reason),
    type,
    bank_gateway,
    created_at: new Date().toISOString(),
    classification,
    is_simulated: 0,
  });

  actionLog.insert({
    payment_id,
    action_type: 'classify',
    justification: `Webhook ingest + ${rule}`,
    outcome: classification,
  });

  return { payment_id, classification };
}

function normalizeReason(raw) {
  const r = String(raw || '').toLowerCase();
  if (r.includes('timeout')) return 'gateway_timeout';
  if (r.includes('network')) return 'network_error';
  if (r.includes('fund') || r.includes('insufficient')) return 'insufficient_funds';
  if (r.includes('expir')) return 'card_expired';
  if (r.includes('mandate')) return 'mandate_not_approved';
  if (r.includes('auth')) return 'auth_failed';
  return 'network_error';
}

function handlePaymentLinkPaid(event) {
  const link = event.payload?.payment_link?.entity || event.payment_link?.entity || {};
  const payment = event.payload?.payment?.entity || event.payment?.entity || {};
  const payment_id = link.reference_id;
  if (!payment_id) {
    return { ignored: true, eventType: 'payment_link.paid', reason: 'missing_reference_id' };
  }

  const existing = payments.getById(payment_id);
  if (!existing) {
    return { ignored: true, eventType: 'payment_link.paid', reason: 'payment_not_found' };
  }
  if (existing.status === 'recovered') {
    return { payment_id, recovered: true, duplicate: true };
  }

  payments.updateStatus(payment_id, 'recovered', {
    attempts_made: (existing.attempts_made || 0) + 1,
  });
  recoveryOutcomes.upsert({
    payment_id,
    recovered: true,
    recovered_amount:
      (payment.amount || link.amount || Math.round(existing.amount * 100)) / 100,
    recovered_at: new Date().toISOString(),
    tactic_used: 'razorpay_payment_link',
    attempts_made: (existing.attempts_made || 0) + 1,
  });
  actionLog.insert({
    payment_id,
    action_type: 'payment_link',
    justification: 'Razorpay payment_link.paid webhook confirmed customer payment',
    outcome: 'recovered',
  });
  return { payment_id, recovered: true };
}

export function handleRazorpayWebhook(event) {
  const eventType = event.event || event.type;
  if (eventType === 'payment.failed') {
    return upsertFailedPayment(event.payload || event, 'one_time');
  }
  if (eventType === 'subscription.charged.failed') {
    return upsertFailedPayment(event.payload || event, 'subscription');
  }
  if (eventType === 'payment_link.paid') {
    return handlePaymentLinkPaid(event);
  }
  return { ignored: true, eventType };
}

export default { verifyWebhookSignature, handleRazorpayWebhook };
