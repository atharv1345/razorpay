import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, '../../data/ryo.db');
const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
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
      budget_window_id TEXT,
      FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
    );

    CREATE TABLE IF NOT EXISTS recovery_outcomes (
      payment_id TEXT PRIMARY KEY,
      recovered INTEGER NOT NULL DEFAULT 0,
      recovered_amount REAL DEFAULT 0,
      recovered_at TEXT,
      tactic_used TEXT,
      attempts_made INTEGER DEFAULT 0,
      FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
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

  // Additive migrations for existing DBs
  const cols = db.prepare(`PRAGMA table_info(payments)`).all().map((c) => c.name);
  if (!cols.includes('relationship_months')) {
    db.exec(`ALTER TABLE payments ADD COLUMN relationship_months INTEGER DEFAULT 0`);
  }
  if (!cols.includes('total_past_payments')) {
    db.exec(`ALTER TABLE payments ADD COLUMN total_past_payments INTEGER DEFAULT 1`);
  }

  // Unique pattern_description via index (idempotent insights)
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_pattern ON insights(pattern_description)`
    );
  } catch {
    /* ignore if duplicates already exist — cleared on next generate */
  }
}

export default db;
