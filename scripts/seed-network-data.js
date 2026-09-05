/**
 * Multi-merchant simulated batch with engineered HDFC outage — SRS FR-12 / Step 16
 * Recovery optimization only — NOT fraud detection.
 * Usage: node scripts/seed-network-data.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../backend/data/ryo.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

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
  CREATE TABLE IF NOT EXISTS network_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_gateway TEXT NOT NULL,
    affected_merchant_ids TEXT NOT NULL,
    failure_rate_delta REAL,
    status TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    justification TEXT
  );
`);

db.prepare(
  `DELETE FROM payments WHERE merchant_id LIKE 'merchant_demo_%' AND merchant_id != 'merchant_demo_1'`
).run();
db.prepare(`DELETE FROM network_events`).run();

const MERCHANTS = Array.from({ length: 8 }, (_, i) => `merchant_demo_${i + 2}`);
const OTHER_BANKS = ['ICICI', 'SBI', 'Axis', 'Kotak'];
const NAMES = ['Ravi', 'Priya', 'Amit', 'Sana', 'Karan', 'Neha', 'Vikram', 'Anjali'];

const insert = db.prepare(`
  INSERT OR REPLACE INTO payments (
    payment_id, merchant_id, customer_name, amount, currency, status,
    failure_reason, type, bank_gateway, created_at, classification, is_simulated
  ) VALUES (?, ?, ?, ?, 'INR', 'failed', ?, 'one_time', ?, ?, 'TRANSIENT', 1)
`);

const now = Date.now();
// Current detector window = last 15m from max(created_at).
// Spike fully inside that window; prior 15m window has almost no HDFC.
const outageStart = now - 14 * 60 * 1000;
const outageEnd = now - 1 * 60 * 1000;

let n = 0;
const tx = db.transaction(() => {
  for (const merchant of MERCHANTS) {
    // Quiet prior window (30–15 min ago): other banks only, low volume
    for (let i = 0; i < 2; i++) {
      n += 1;
      const t = now - (28 - i * 5) * 60 * 1000;
      insert.run(
        `pay_net_${merchant}_${i}_prior`,
        merchant,
        NAMES[i % NAMES.length],
        500 + Math.round(Math.random() * 1500),
        'network_error',
        OTHER_BANKS[i % OTHER_BANKS.length],
        new Date(t).toISOString()
      );
    }

    // Sparse older baseline (2h ago) — includes a little HDFC so bank exists historically
    for (let i = 0; i < 3; i++) {
      n += 1;
      const t = now - (100 - i * 10) * 60 * 1000;
      insert.run(
        `pay_net_${merchant}_${i}_old`,
        merchant,
        NAMES[i % NAMES.length],
        400 + Math.round(Math.random() * 1000),
        'gateway_timeout',
        i === 0 ? 'HDFC' : OTHER_BANKS[i % OTHER_BANKS.length],
        new Date(t).toISOString()
      );
    }

    // Engineered HDFC spike: merchants 2–5, inside current 15m window
    const merchantNum = Number(merchant.split('_').pop());
    if (merchantNum >= 2 && merchantNum <= 5) {
      for (let i = 0; i < 12; i++) {
        n += 1;
        const t = outageStart + Math.floor((i / 12) * (outageEnd - outageStart));
        insert.run(
          `pay_net_${merchant}_${i}_hdfc_spike`,
          merchant,
          NAMES[i % NAMES.length],
          800 + Math.round(Math.random() * 3000),
          'gateway_timeout',
          'HDFC',
          new Date(t).toISOString()
        );
      }
    }

    // Tiny post-normalization non-HDFC sample near "now" (keeps anchor fresh)
    n += 1;
    insert.run(
      `pay_net_${merchant}_anchor`,
      merchant,
      NAMES[0],
      350,
      'network_error',
      OTHER_BANKS[merchantNum % OTHER_BANKS.length],
      new Date(now - 30 * 1000).toISOString()
    );
  }
});
tx();

console.log(`Seeded ${n} simulated multi-merchant payments with engineered HDFC outage`);
console.log('Merchants:', MERCHANTS.join(', '));
console.log('(Simulated multi-merchant data — for recovery optimization, not fraud detection)');
db.close();
