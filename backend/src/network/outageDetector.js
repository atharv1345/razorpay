/**
 * Network Intelligence — bank/gateway outage detection for smarter recovery.
 * NOT fraud detection — pauses doomed retries during outages (SRS §1.2, FR-13).
 *
 * Uses simulated multi-merchant rows (is_simulated=1) and compares
 * current rolling window vs prior window of equal length.
 */
import db from '../db/index.js';
import { networkEvents } from '../db/queries.js';
import config from '../config.js';

function anchorTime() {
  const row = db
    .prepare(
      `SELECT MAX(created_at) as t FROM payments WHERE is_simulated = 1 AND bank_gateway IS NOT NULL`
    )
    .get();
  return row?.t ? new Date(row.t).getTime() : Date.now();
}

export function computeRollingFailureRate(
  bank_gateway,
  windowMinutes = config.OUTAGE_WINDOW_MINUTES,
  endMs = null
) {
  const end = endMs ?? anchorTime();
  const start = end - windowMinutes * 60 * 1000;
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();

  const rows = db
    .prepare(
      `SELECT merchant_id, COUNT(*) as c FROM payments
       WHERE bank_gateway = ?
         AND is_simulated = 1
         AND created_at >= ? AND created_at <= ?
       GROUP BY merchant_id`
    )
    .all(bank_gateway, startIso, endIso);

  const total = rows.reduce((s, r) => s + r.c, 0);
  const merchants = rows.map((r) => r.merchant_id);
  const rate = total / Math.max(windowMinutes, 1);
  return { rate, count: total, merchants, windowStart: startIso, windowEnd: endIso };
}

export function detectOutage() {
  const banks = db
    .prepare(
      `SELECT DISTINCT bank_gateway FROM payments
       WHERE is_simulated = 1 AND bank_gateway IS NOT NULL`
    )
    .all()
    .map((r) => r.bank_gateway);

  const end = anchorTime();
  const window = config.OUTAGE_WINDOW_MINUTES;
  const flagged = [];

  for (const bank of banks) {
    if (networkEvents.activeFlag(bank)) continue;

    const current = computeRollingFailureRate(bank, window, end);
    // Prior window of equal length immediately before current
    const baseline = computeRollingFailureRate(bank, window, end - window * 60 * 1000);

    const baselineRate = Math.max(baseline.rate, 0.05);
    const delta = current.rate / baselineRate;

    // Engineered outage bar: spike vs prior window, enough volume, multi-merchant
    if (
      delta >= config.OUTAGE_THRESHOLD_MULTIPLIER &&
      current.merchants.length >= 3 &&
      current.count >= 15
    ) {
      const justification = `${bank} failure rate ${delta.toFixed(1)}x prior window across ${current.merchants.length} merchants (${current.count} failures in ${window}m) — pausing TRANSIENT retries & CARD_ISSUE links to protect recovery budget`;
      networkEvents.insert({
        bank_gateway: bank,
        affected_merchant_ids: current.merchants,
        failure_rate_delta: Math.round(delta * 100) / 100,
        status: 'flagged',
        justification,
      });
      flagged.push(bank);
    }
  }
  return flagged;
}

export function checkResume() {
  const banks = db
    .prepare(
      `SELECT DISTINCT bank_gateway FROM payments
       WHERE is_simulated = 1 AND bank_gateway IS NOT NULL`
    )
    .all()
    .map((r) => r.bank_gateway);

  const end = anchorTime();
  const window = config.OUTAGE_WINDOW_MINUTES;
  const resumed = [];

  for (const bank of banks) {
    const active = networkEvents.activeFlag(bank);
    if (!active) continue;

    const current = computeRollingFailureRate(bank, window, end);
    const baseline = computeRollingFailureRate(bank, window, end - window * 60 * 1000);
    const baselineRate = Math.max(baseline.rate, 0.05);
    const delta = current.rate / baselineRate;

    if (delta < config.OUTAGE_THRESHOLD_MULTIPLIER || current.count < 5) {
      networkEvents.insert({
        bank_gateway: bank,
        affected_merchant_ids: current.merchants,
        failure_rate_delta: Math.round(delta * 100) / 100,
        status: 'resumed',
        justification: `${bank} failure rate normalized (${delta.toFixed(1)}x prior window) — resuming recovery actions`,
      });
      resumed.push(bank);
    }
  }
  return resumed;
}

export function forceResume(bank_gateway) {
  const active = networkEvents.activeFlag(bank_gateway);
  if (!active) return null;
  let merchants = [];
  try {
    merchants = JSON.parse(active.affected_merchant_ids);
  } catch {
    merchants = [];
  }
  networkEvents.insert({
    bank_gateway,
    affected_merchant_ids: merchants,
    failure_rate_delta: 1.0,
    status: 'resumed',
    justification: `${bank_gateway} outage cleared — automatically resuming TRANSIENT retries and CARD_ISSUE payment links`,
  });
  return true;
}

export default { computeRollingFailureRate, detectOutage, checkResume, forceResume };
