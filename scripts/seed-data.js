/**
 * Seed 80 synthetic failed payments — single merchant (SRS §8.2 / Step 3)
 * Usage: node scripts/seed-data.js --reset
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
    promised_date TEXT
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
`);

if (reset) {
  db.exec(`
    DELETE FROM action_log;
    DELETE FROM recovery_outcomes;
    DELETE FROM insights;
    DELETE FROM network_events;
    DELETE FROM batch_progress;
    DELETE FROM bandit_state;
    DELETE FROM payments WHERE merchant_id = 'merchant_demo_1';
  `);
}

const NAMES = [
  'Aarav Sharma', 'Diya Patel', 'Rohan Gupta', 'Ananya Iyer', 'Kabir Singh',
  'Ishita Mehta', 'Vivaan Reddy', 'Sara Khan', 'Arjun Nair', 'Meera Joshi',
  'Advait Desai', 'Pooja Rao', 'Neil Chopra', 'Kavya Menon', 'Yash Malhotra',
  'Riya Banerjee', 'Harsh Verma', 'Sneha Kulkarni', 'Aditya Pillai', 'Nisha Agarwal',
];
const BANKS = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function amount() {
  return Math.round((199 + Math.random() * (9999 - 199)) * 100) / 100;
}

function daysAgo(n, jitterHours = 24) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(d.getHours() - Math.floor(Math.random() * jitterHours));
  return d.toISOString();
}

const insert = db.prepare(`
  INSERT OR REPLACE INTO payments (
    payment_id, merchant_id, customer_name, amount, currency, status,
    failure_reason, type, bank_gateway, created_at, classification, is_simulated
  ) VALUES (
    @payment_id, @merchant_id, @customer_name, @amount, 'INR', 'failed',
    @failure_reason, @type, @bank_gateway, @created_at, NULL, 0
  )
`);

const classifyLog = db.prepare(`
  INSERT INTO action_log (payment_id, action_type, channel, timestamp, justification, outcome, budget_window_id)
  VALUES (?, 'classify', NULL, ?, ?, ?, NULL)
`);

function classify(reason, type) {
  if (['network_error', 'gateway_timeout'].includes(reason)) {
    return { c: 'TRANSIENT', rule: `failure_reason='${reason}' → TRANSIENT` };
  }
  if (['card_expired', 'insufficient_funds'].includes(reason)) {
    return { c: 'CARD_ISSUE', rule: `failure_reason='${reason}' → CARD_ISSUE` };
  }
  if (['mandate_not_approved', 'auth_failed'].includes(reason) && type === 'subscription') {
    return { c: 'MANDATE_ISSUE', rule: `failure_reason='${reason}' + subscription → MANDATE_ISSUE` };
  }
  return { c: 'CARD_ISSUE', rule: `defaulted → CARD_ISSUE` };
}

const rows = [];
// 40% TRANSIENT, 35% CARD, 25% MANDATE (subscription only)
for (let i = 0; i < 80; i++) {
  const r = Math.random();
  let failure_reason;
  let type = Math.random() < 0.7 ? 'one_time' : 'subscription';
  if (r < 0.4) {
    failure_reason = pick(['network_error', 'gateway_timeout']);
  } else if (r < 0.75) {
    failure_reason = pick(['card_expired', 'insufficient_funds']);
  } else {
    failure_reason = pick(['mandate_not_approved', 'auth_failed']);
    type = 'subscription';
  }
  rows.push({
    payment_id: `pay_demo_${String(i + 1).padStart(3, '0')}`,
    merchant_id: 'merchant_demo_1',
    customer_name: pick(NAMES),
    amount: amount(),
    failure_reason,
    type,
    bank_gateway: pick(BANKS),
    created_at: daysAgo(Math.floor(Math.random() * 7)),
  });
}

const tx = db.transaction(() => {
  for (const row of rows) {
    insert.run(row);
    const { c, rule } = classify(row.failure_reason, row.type);
    db.prepare(`UPDATE payments SET classification = ? WHERE payment_id = ?`).run(
      c,
      row.payment_id
    );
    classifyLog.run(row.payment_id, new Date().toISOString(), rule, c);
  }
});
tx();

console.log(`Seeded ${rows.length} payments for merchant_demo_1 into ${dbPath}`);
db.close();
