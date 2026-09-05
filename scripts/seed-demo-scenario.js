/**
 * Master demo seed — cohesive narratable dataset for hackathon demo.
 * Usage: node scripts/seed-demo-scenario.js --reset
 *
 * Each block is labeled with the FEATURE it demonstrates.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../backend/data/ryo.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const reset = process.argv.includes('--reset');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'failed',
    failure_reason TEXT,
    type TEXT NOT NULL DEFAULT 'one_time',
    bank_gateway TEXT,
    created_at TEXT NOT NULL,
    classification TEXT,
    priority_score REAL,
    next_attempt_at TEXT,
    is_simulated INTEGER NOT NULL DEFAULT 0,
    attempts_made INTEGER NOT NULL DEFAULT 0,
    promised_date TEXT,
    relationship_months INTEGER DEFAULT 0,
    total_past_payments INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS action_log (
    action_id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT,
    action_type TEXT NOT NULL,
    channel TEXT,
    timestamp TEXT NOT NULL,
    justification TEXT,
    outcome TEXT,
    budget_window_id TEXT
  );
  CREATE TABLE IF NOT EXISTS recovery_outcomes (
    payment_id TEXT PRIMARY KEY,
    recovered INTEGER NOT NULL DEFAULT 0,
    recovered_amount REAL DEFAULT 0,
    recovered_at TEXT,
    tactic_used TEXT,
    attempts_made INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bandit_state (
    segment TEXT PRIMARY KEY,
    success_count INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    current_allocation_weight REAL NOT NULL DEFAULT 0.5
  );
  CREATE TABLE IF NOT EXISTS insights (
    insight_id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_description TEXT NOT NULL,
    affected_count INTEGER NOT NULL,
    suggested_fix TEXT,
    generated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS network_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_gateway TEXT NOT NULL,
    affected_merchant_ids TEXT NOT NULL,
    failure_rate_delta REAL,
    status TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    justification TEXT
  );
  CREATE TABLE IF NOT EXISTS batch_progress (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    naive_json TEXT,
    optimized_json TEXT,
    phase TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS customer_history (
    customer_name TEXT PRIMARY KEY,
    relationship_months INTEGER NOT NULL DEFAULT 0,
    total_past_payments INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS active_subscriptions (
    subscription_id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    amount REAL NOT NULL,
    card_expiry_date TEXT,
    recent_late_charges INTEGER NOT NULL DEFAULT 0,
    merchant_id TEXT NOT NULL DEFAULT 'merchant_demo_1'
  );
  CREATE TABLE IF NOT EXISTS at_risk_predictions (
    prediction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    reason TEXT NOT NULL,
    predicted_at TEXT NOT NULL
  );
`);

try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_pattern ON insights(pattern_description)`);
} catch { /* ok */ }

const cols = db.prepare(`PRAGMA table_info(payments)`).all().map((c) => c.name);
if (!cols.includes('relationship_months')) {
  db.exec(`ALTER TABLE payments ADD COLUMN relationship_months INTEGER DEFAULT 0`);
}
if (!cols.includes('total_past_payments')) {
  db.exec(`ALTER TABLE payments ADD COLUMN total_past_payments INTEGER DEFAULT 1`);
}

if (reset) {
  db.exec(`
    DELETE FROM action_log;
    DELETE FROM recovery_outcomes;
    DELETE FROM insights;
    DELETE FROM network_events;
    DELETE FROM batch_progress;
    DELETE FROM bandit_state;
    DELETE FROM at_risk_predictions;
    DELETE FROM active_subscriptions;
    DELETE FROM customer_history;
    DELETE FROM payments;
  `);
}

const insertPay = db.prepare(`
  INSERT OR REPLACE INTO payments (
    payment_id, merchant_id, customer_name, amount, currency, status,
    failure_reason, type, bank_gateway, created_at, classification,
    is_simulated, attempts_made, promised_date, relationship_months, total_past_payments
  ) VALUES (
    @payment_id, @merchant_id, @customer_name, @amount, 'INR', @status,
    @failure_reason, @type, @bank_gateway, @created_at, @classification,
    @is_simulated, @attempts_made, @promised_date, @relationship_months, @total_past_payments
  )
`);

const insertLog = db.prepare(`
  INSERT INTO action_log (payment_id, action_type, channel, timestamp, justification, outcome, budget_window_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const upsertHist = db.prepare(`
  INSERT INTO customer_history (customer_name, relationship_months, total_past_payments)
  VALUES (?, ?, ?)
  ON CONFLICT(customer_name) DO UPDATE SET
    relationship_months = excluded.relationship_months,
    total_past_payments = excluded.total_past_payments
`);

const upsertSub = db.prepare(`
  INSERT INTO active_subscriptions
  (subscription_id, customer_name, amount, card_expiry_date, recent_late_charges, merchant_id)
  VALUES (?, ?, ?, ?, ?, 'merchant_demo_1')
  ON CONFLICT(subscription_id) DO UPDATE SET
    customer_name = excluded.customer_name,
    amount = excluded.amount,
    card_expiry_date = excluded.card_expiry_date,
    recent_late_charges = excluded.recent_late_charges
`);

const upsertPred = db.prepare(`
  INSERT INTO at_risk_predictions (subscription_id, customer_name, risk_level, reason, predicted_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(subscription_id) DO UPDATE SET
    risk_level = excluded.risk_level,
    reason = excluded.reason,
    predicted_at = excluded.predicted_at
`);

function isoDaysAgo(days, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, Math.floor(Math.random() * 40), 0, 0);
  return d.toISOString();
}

function classify(reason, type) {
  if (['network_error', 'gateway_timeout'].includes(reason)) return 'TRANSIENT';
  if (['card_expired', 'insufficient_funds'].includes(reason)) return 'CARD_ISSUE';
  if (['mandate_not_approved', 'auth_failed'].includes(reason) && type === 'subscription') {
    return 'MANDATE_ISSUE';
  }
  return 'CARD_ISSUE';
}

function pay(row) {
  const classification = row.classification || classify(row.failure_reason, row.type || 'one_time');
  insertPay.run({
    merchant_id: 'merchant_demo_1',
    status: 'failed',
    type: 'one_time',
    bank_gateway: 'ICICI',
    is_simulated: 0,
    attempts_made: 0,
    promised_date: null,
    relationship_months: 0,
    total_past_payments: 1,
    ...row,
    classification,
  });
  insertLog.run(
    row.payment_id,
    'classify',
    null,
    new Date().toISOString(),
    `seed: ${row.failure_reason} → ${classification}`,
    classification,
    null
  );
  if (row.customer_name) {
    upsertHist.run(
      row.customer_name,
      row.relationship_months || 0,
      row.total_past_payments || 1
    );
  }
}

let counts = {
  transient: 0,
  card: 0,
  mandate: 0,
  salary: 0,
  ptp: 0,
  leak: 0,
  network: 0,
  predictions: 0,
};

const tx = db.transaction(() => {
  // ─── 1. TRANSIENT examples (demo audit: success + exhaust) ───
  const transient = [
    { payment_id: 'pay_demo_001', customer_name: 'Aarav Sharma', amount: 2499, failure_reason: 'network_error', bank_gateway: 'SBI' },
    { payment_id: 'pay_demo_002', customer_name: 'Diya Patel', amount: 1899, failure_reason: 'gateway_timeout', bank_gateway: 'Axis' },
    { payment_id: 'pay_demo_003', customer_name: 'Rohan Gupta', amount: 5299, failure_reason: 'network_error', bank_gateway: 'Kotak' },
    { payment_id: 'pay_demo_004', customer_name: 'Ananya Iyer', amount: 799, failure_reason: 'gateway_timeout', bank_gateway: 'SBI' },
    { payment_id: 'pay_demo_005', customer_name: 'Kabir Singh', amount: 3499, failure_reason: 'network_error', bank_gateway: 'ICICI' },
  ];
  for (const t of transient) {
    pay({ ...t, created_at: isoDaysAgo(1), relationship_months: 3, total_past_payments: 4 });
    counts.transient += 1;
  }

  // ─── 2. CARD_ISSUE with CLV spread (1 mo vs 20 mo) ───
  const cards = [
    { payment_id: 'pay_demo_010', customer_name: 'New User One', amount: 999, failure_reason: 'card_expired', relationship_months: 1, total_past_payments: 1 },
    { payment_id: 'pay_demo_011', customer_name: 'New User Two', amount: 1299, failure_reason: 'insufficient_funds', relationship_months: 1, total_past_payments: 2 },
    { payment_id: 'pay_demo_012', customer_name: 'Meera Joshi', amount: 2199, failure_reason: 'card_expired', relationship_months: 8, total_past_payments: 12 },
    { payment_id: 'pay_demo_013', customer_name: 'Vivaan Reddy', amount: 4599, failure_reason: 'insufficient_funds', relationship_months: 12, total_past_payments: 20 },
    { payment_id: 'pay_demo_014', customer_name: 'Sara Khan', amount: 8799, failure_reason: 'card_expired', relationship_months: 18, total_past_payments: 35 },
    { payment_id: 'pay_demo_015', customer_name: 'Arjun Nair', amount: 6499, failure_reason: 'insufficient_funds', relationship_months: 20, total_past_payments: 42 },
    { payment_id: 'pay_demo_016', customer_name: 'Ishita Mehta', amount: 1599, failure_reason: 'card_expired', relationship_months: 4, total_past_payments: 5 },
    { payment_id: 'pay_demo_017', customer_name: 'Advait Desai', amount: 3299, failure_reason: 'insufficient_funds', relationship_months: 15, total_past_payments: 28 },
  ];
  for (const c of cards) {
    pay({ ...c, created_at: isoDaysAgo(2), bank_gateway: 'ICICI', type: 'one_time' });
    counts.card += 1;
  }

  // ─── 3. MANDATE_ISSUE subscriptions ───
  const mandates = [
    { payment_id: 'pay_demo_020', customer_name: 'Pooja Rao', amount: 499, failure_reason: 'mandate_not_approved' },
    { payment_id: 'pay_demo_021', customer_name: 'Neil Chopra', amount: 799, failure_reason: 'auth_failed' },
    { payment_id: 'pay_demo_022', customer_name: 'Kavya Menon', amount: 999, failure_reason: 'mandate_not_approved' },
    { payment_id: 'pay_demo_023', customer_name: 'Yash Malhotra', amount: 1299, failure_reason: 'auth_failed' },
  ];
  for (const m of mandates) {
    pay({
      ...m,
      type: 'subscription',
      created_at: isoDaysAgo(3),
      bank_gateway: 'HDFC',
      relationship_months: 6,
      total_past_payments: 8,
    });
    counts.mandate += 1;
  }

  // ─── 4. Salary-date examples (insufficient_funds, mid-month so scheduler defers) ───
  // Force created_at mid-month-ish; scheduler uses "now" — if today is salary window,
  // still seed justification via a deferred status pre-log for demo visibility.
  const salaryCustomers = [
    { payment_id: 'pay_demo_030', customer_name: 'Riya Banerjee', amount: 4999 },
    { payment_id: 'pay_demo_031', customer_name: 'Harsh Verma', amount: 2999 },
    { payment_id: 'pay_demo_032', customer_name: 'Sneha Kulkarni', amount: 3999 },
  ];
  for (const s of salaryCustomers) {
    pay({
      ...s,
      failure_reason: 'insufficient_funds',
      created_at: isoDaysAgo(0, 14),
      bank_gateway: 'Axis',
      relationship_months: 10,
      total_past_payments: 15,
    });
    // Pre-seed salary_date_scheduled audit row so badge is visible even before batch
    const day = new Date();
    day.setMonth(day.getMonth() + 1, 1);
    day.setHours(10, 0, 0, 0);
    insertLog.run(
      s.payment_id,
      'salary_date_scheduled',
      null,
      new Date().toISOString(),
      `scheduled for day ${day.getDate()}: insufficient_funds recovery rate 3.2x higher near salary date`,
      'deferred',
      null
    );
    counts.salary += 1;
  }

  // ─── 5. Promise-to-pay example ───
  pay({
    payment_id: 'pay_demo_040',
    customer_name: 'Aditya Pillai',
    amount: 1799,
    failure_reason: 'card_expired',
    created_at: isoDaysAgo(1),
    status: 'promise_to_pay',
    promised_date: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(11, 0, 0, 0);
      return d.toISOString();
    })(),
    relationship_months: 9,
    total_past_payments: 11,
  });
  insertLog.run(
    'pay_demo_040',
    'scheduled_followup',
    null,
    new Date().toISOString(),
    'PTP detected from reply "I\'ll pay tomorrow" → follow-up scheduled; nudges suppressed until then',
    'promise_to_pay',
    null
  );
  counts.ptp = 1;

  // ─── 8. Leak-to-Fix: 16 network_error at hour 19 (single clear pattern) ───
  for (let i = 0; i < 16; i++) {
    const id = `pay_demo_${String(50 + i).padStart(3, '0')}`;
    pay({
      payment_id: id,
      customer_name: `Evening User ${i + 1}`,
      amount: 500 + i * 50,
      failure_reason: 'network_error',
      created_at: isoDaysAgo(2 + (i % 3), 19),
      bank_gateway: 'SBI',
      relationship_months: 2,
      total_past_payments: 3,
    });
    counts.leak += 1;
  }

  // Extra filler so metrics / compare have volume (~80 core total feel)
  for (let i = 0; i < 20; i++) {
    const reasons = ['network_error', 'gateway_timeout', 'card_expired', 'insufficient_funds'];
    const reason = reasons[i % reasons.length];
    const type = reason.includes('mandate') ? 'subscription' : i % 5 === 0 ? 'subscription' : 'one_time';
    pay({
      payment_id: `pay_demo_${String(70 + i).padStart(3, '0')}`,
      customer_name: `Batch Customer ${i + 1}`,
      amount: 699 + i * 120,
      failure_reason: reason,
      type: type === 'subscription' && ['auth_failed', 'mandate_not_approved'].includes(reason)
        ? 'subscription'
        : type,
      created_at: isoDaysAgo(i % 6, 10 + (i % 8)),
      bank_gateway: ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak'][i % 5],
      relationship_months: i % 2 === 0 ? 14 : 2,
      total_past_payments: i % 2 === 0 ? 22 : 2,
    });
  }

  // Fix subscription types for mandate in filler if needed — skip

  // ─── 6. Network outage: HDFC spike across merchant_demo_2..5 ───
  const now = Date.now();
  const outageStart = now - 14 * 60 * 1000;
  const outageEnd = now - 1 * 60 * 1000;
  const OTHER = ['ICICI', 'SBI', 'Axis', 'Kotak'];

  for (let m = 2; m <= 9; m++) {
    const merchant = `merchant_demo_${m}`;
    // Quiet prior window
    for (let i = 0; i < 2; i++) {
      insertPay.run({
        payment_id: `pay_net_${merchant}_${i}_prior`,
        merchant_id: merchant,
        customer_name: `Net ${m}-${i}`,
        amount: 800,
        status: 'failed',
        failure_reason: 'network_error',
        type: 'one_time',
        bank_gateway: OTHER[i % OTHER.length],
        created_at: new Date(now - (28 - i * 5) * 60 * 1000).toISOString(),
        classification: 'TRANSIENT',
        is_simulated: 1,
        attempts_made: 0,
        promised_date: null,
        relationship_months: 0,
        total_past_payments: 1,
      });
      counts.network += 1;
    }
    // Old baseline with tiny HDFC
    insertPay.run({
      payment_id: `pay_net_${merchant}_old_hdfc`,
      merchant_id: merchant,
      customer_name: `Old ${m}`,
      amount: 400,
      status: 'failed',
      failure_reason: 'gateway_timeout',
      type: 'one_time',
      bank_gateway: 'HDFC',
      created_at: new Date(now - 100 * 60 * 1000).toISOString(),
      classification: 'TRANSIENT',
      is_simulated: 1,
      attempts_made: 0,
      promised_date: null,
      relationship_months: 0,
      total_past_payments: 1,
    });
    counts.network += 1;

    if (m >= 2 && m <= 5) {
      for (let i = 0; i < 12; i++) {
        const t = outageStart + Math.floor((i / 12) * (outageEnd - outageStart));
        insertPay.run({
          payment_id: `pay_net_${merchant}_${i}_hdfc_spike`,
          merchant_id: merchant,
          customer_name: `Spike ${m}-${i}`,
          amount: 1200,
          status: 'failed',
          failure_reason: 'gateway_timeout',
          type: 'one_time',
          bank_gateway: 'HDFC',
          created_at: new Date(t).toISOString(),
          classification: 'TRANSIENT',
          is_simulated: 1,
          attempts_made: 0,
          promised_date: null,
          relationship_months: 0,
          total_past_payments: 1,
        });
        counts.network += 1;
      }
    }

    insertPay.run({
      payment_id: `pay_net_${merchant}_anchor`,
      merchant_id: merchant,
      customer_name: `Anchor ${m}`,
      amount: 350,
      status: 'failed',
      failure_reason: 'network_error',
      type: 'one_time',
      bank_gateway: OTHER[m % OTHER.length],
      created_at: new Date(now - 30 * 1000).toISOString(),
      classification: 'TRANSIENT',
      is_simulated: 1,
      attempts_made: 0,
      promised_date: null,
      relationship_months: 0,
      total_past_payments: 1,
    });
    counts.network += 1;
  }

  // ─── 7. Predictive failure: 5 active subscriptions ───
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soon2 = new Date();
  soon2.setDate(soon2.getDate() + 5);
  const later = new Date();
  later.setMonth(later.getMonth() + 8);

  const subs = [
    { id: 'sub_demo_01', name: 'Card Expiry A', amount: 999, expiry: soon.toISOString().slice(0, 10), late: 0, risk: 'HIGH', reason: 'card_expiring_soon' },
    { id: 'sub_demo_02', name: 'Card Expiry B', amount: 1499, expiry: soon2.toISOString().slice(0, 10), late: 0, risk: 'HIGH', reason: 'card_expiring_soon' },
    { id: 'sub_demo_03', name: 'Friction User', amount: 799, expiry: later.toISOString().slice(0, 10), late: 2, risk: 'MEDIUM', reason: 'recent_payment_friction' },
    { id: 'sub_demo_04', name: 'Stable Sub One', amount: 499, expiry: later.toISOString().slice(0, 10), late: 0, risk: 'LOW', reason: 'stable' },
    { id: 'sub_demo_05', name: 'Stable Sub Two', amount: 599, expiry: later.toISOString().slice(0, 10), late: 1, risk: 'LOW', reason: 'stable' },
  ];
  for (const s of subs) {
    upsertSub.run(s.id, s.name, s.amount, s.expiry, s.late);
    if (s.risk !== 'LOW') {
      upsertPred.run(s.id, s.name, s.risk, s.reason, new Date().toISOString());
      counts.predictions += 1;
    }
  }

  // Preemptive nudges are owned by predictRisk.runPredictions() (idempotent).
  // Do NOT insert preemptive_nudge rows here — that caused duplicate audit entries
  // when resetDemo / page refresh re-ran predictions.
});

tx();

console.log(
  `Seeded: ${counts.transient} transient, ${counts.card} card_issue, ${counts.mandate} mandate_issue, 1 outage scenario (HDFC, 4 merchants), ${counts.predictions} at-risk predictions, ${counts.ptp} promise-to-pay example.`
);
console.log(`Also: ${counts.salary} salary-date examples, ${counts.leak} hour-19 leak pattern rows, ${counts.network} simulated network rows.`);
console.log(`DB: ${dbPath}`);
db.close();
