import config from '../config.js';
import Razorpay from 'razorpay';
import { payments, actionLog, recoveryOutcomes, customerHistory } from '../db/queries.js';
import { selectChannel, recordOutcome } from '../bandit/epsilonGreedy.js';
import { planSalaryAwareSchedule } from './salaryDateScheduler.js';

function inQuietHours(date = new Date()) {
  const check =
    config.RAZORPAY_SANDBOX_MODE === 'simulate'
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)
      : date;
  const h = check.getHours();
  return h < config.QUIET_HOURS_START || h >= config.QUIET_HOURS_END;
}

function customerRel(payment) {
  return (
    customerHistory.get(payment.customer_name) || {
      relationship_months: payment.relationship_months || 0,
      total_past_payments: payment.total_past_payments || 1,
    }
  );
}

function buildMessage(channel, payment, link) {
  const rel = customerRel(payment);
  const isRepeat = (rel.relationship_months || 0) >= 6;

  if (isRepeat) {
    const warm = {
      sms_link: `Hi ${payment.customer_name}, as a valued customer of ${rel.relationship_months} months, your ₹${payment.amount} payment needs a quick retry: ${link}`,
      whatsapp_link: `Namaste ${payment.customer_name}! Aap hamare ${rel.relationship_months}-month customer ho — ₹${payment.amount} pending hai. Link: ${link}`,
      hinglish_nudge: `${payment.customer_name} ji, ${rel.relationship_months} mahine se saath hain aap — ₹${payment.amount} complete karein: ${link}`,
    };
    return { message: warm[channel], warm: true, months: rel.relationship_months };
  }

  const standard = {
    sms_link: `Hi ${payment.customer_name}, your payment of ₹${payment.amount} failed. Complete it here: ${link}`,
    whatsapp_link: `Namaste ${payment.customer_name}! Payment of ₹${payment.amount} abhi pending hai. Link: ${link}`,
    hinglish_nudge: `${payment.customer_name} ji, ₹${payment.amount} ka payment fail ho gaya. Ek click mein complete karein: ${link}`,
  };
  return { message: standard[channel], warm: false, months: rel.relationship_months || 0 };
}

function fakePaymentLink(payment) {
  return `https://rzp.io/i/demo_${payment.payment_id.slice(-8)}`;
}

function isSimulationMode() {
  return config.RAZORPAY_SANDBOX_MODE !== 'test';
}

async function createPaymentLink(payment) {
  if (isSimulationMode()) {
    return { short_url: fakePaymentLink(payment), mode: 'simulation' };
  }

  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay Test Mode requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }

  const razorpay = new Razorpay({
    key_id: config.RAZORPAY_KEY_ID,
    key_secret: config.RAZORPAY_KEY_SECRET,
  });
  const link = await razorpay.paymentLink.create({
    amount: Math.round(payment.amount * 100),
    currency: payment.currency || 'INR',
    description: `Recovery payment for ${payment.payment_id}`,
    reference_id: payment.payment_id.slice(0, 40),
    expire_by: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    notify: { sms: false, email: false },
    reminder_enable: true,
  });
  return { short_url: link.short_url, mode: 'razorpay_test' };
}

function simulateLinkRecovery(payment, salaryBoost = false) {
  let rate = 0.35;
  if (payment.failure_reason === 'insufficient_funds' && salaryBoost) rate = 0.55;
  if (payment.failure_reason === 'card_expired') rate = 0.3;
  return Math.random() < rate;
}

export async function sendPaymentLink(payment, ctx = {}) {
  const now = new Date();

  const salaryPlan = planSalaryAwareSchedule(payment, now);
  if (salaryPlan?.shouldDefer) {
    payments.updateStatus(payment.payment_id, 'deferred', {
      next_attempt_at: salaryPlan.scheduledAt.toISOString(),
    });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'salary_date_scheduled',
      justification: salaryPlan.justification,
      outcome: 'deferred',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, deferred: true, salaryAware: true };
  }

  if (inQuietHours(now)) {
    const next = new Date(now);
    next.setHours(config.QUIET_HOURS_START, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    payments.updateStatus(payment.payment_id, 'deferred', {
      next_attempt_at: next.toISOString(),
    });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'payment_link',
      justification: `Outside quiet hours (${config.QUIET_HOURS_START}–${config.QUIET_HOURS_END}) — deferred to ${next.toISOString()}`,
      outcome: 'deferred_quiet_hours',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, deferred: true };
  }

  const { channel, mode } = selectChannel(payment.classification);
  let paymentLink;
  try {
    paymentLink = await createPaymentLink(payment);
  } catch (err) {
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'payment_link',
      channel,
      justification: `Payment Link creation failed: ${err.message}`,
      outcome: 'error',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: false, error: true, message: err.message };
  }
  const link = paymentLink.short_url;
  const { message, warm, months } = buildMessage(channel, payment, link);

  actionLog.insert({
    payment_id: payment.payment_id,
    action_type: 'payment_link',
    channel,
    justification: `Bandit ${mode}: channel=${channel}${
      warm ? ` | warm tone for ${months}-month repeat customer` : ''
    }. Message: "${message}" | mode=${paymentLink.mode}${salaryPlan?.salaryAware ? ` | ${salaryPlan.justification}` : ''}`,
    outcome: 'sent',
    budget_window_id: ctx.budgetWindowId,
  });

  const recovered = simulateLinkRecovery(payment, salaryPlan && !salaryPlan.shouldDefer);
  recordOutcome(payment.classification, channel, recovered);

  if (recovered) {
    payments.updateStatus(payment.payment_id, 'recovered', {
      attempts_made: (payment.attempts_made || 0) + 1,
    });
    recoveryOutcomes.upsert({
      payment_id: payment.payment_id,
      recovered: true,
      recovered_amount: payment.amount,
      recovered_at: new Date().toISOString(),
      tactic_used: channel,
      attempts_made: (payment.attempts_made || 0) + 1,
    });
    actionLog.insert({
      payment_id: payment.payment_id,
      action_type: 'payment_link',
      channel,
      justification: `Customer completed payment link via ${channel}`,
      outcome: 'recovered',
      budget_window_id: ctx.budgetWindowId,
    });
    return { recovered: true, channel, salaryAware: !!salaryPlan };
  }

  const followUp = new Date(Date.now() + 24 * 60 * 60 * 1000);
  payments.updateStatus(payment.payment_id, 'link_sent', {
    attempts_made: (payment.attempts_made || 0) + 1,
    next_attempt_at: followUp.toISOString(),
  });
  actionLog.insert({
    payment_id: payment.payment_id,
    action_type: 'payment_link',
    channel,
    justification: `Link sent via ${channel}; max 1 follow-up scheduled after 24h`,
    outcome: 'awaiting_customer',
    budget_window_id: ctx.budgetWindowId,
  });
  return { recovered: false, channel, salaryAware: !!salaryPlan };
}

export default sendPaymentLink;
