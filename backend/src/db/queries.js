import db from './index.js';

const now = () => new Date().toISOString();

export const payments = {
  insert(row) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO payments (
        payment_id, merchant_id, customer_name, amount, currency, status,
        failure_reason, type, bank_gateway, created_at, classification,
        priority_score, next_attempt_at, is_simulated, attempts_made, promised_date,
        relationship_months, total_past_payments
      ) VALUES (
        @payment_id, @merchant_id, @customer_name, @amount, @currency, @status,
        @failure_reason, @type, @bank_gateway, @created_at, @classification,
        @priority_score, @next_attempt_at, @is_simulated, @attempts_made, @promised_date,
        @relationship_months, @total_past_payments
      )
    `);
    return stmt.run({
      currency: 'INR',
      status: 'failed',
      classification: null,
      priority_score: null,
      next_attempt_at: null,
      is_simulated: 0,
      attempts_made: 0,
      promised_date: null,
      relationship_months: 0,
      total_past_payments: 1,
      ...row,
    });
  },

  getById(payment_id) {
    return db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(payment_id);
  },

  listAll(filters = {}) {
    let sql = 'SELECT * FROM payments WHERE 1=1';
    const params = [];
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.merchant_id) {
      sql += ' AND merchant_id = ?';
      params.push(filters.merchant_id);
    }
    if (filters.unclassified) {
      sql += ' AND classification IS NULL';
    }
    sql += ' ORDER BY created_at ASC';
    return db.prepare(sql).all(...params);
  },

  listUnresolved({ includeSimulated = false } = {}) {
    if (includeSimulated) {
      return db
        .prepare(
          `SELECT * FROM payments
           WHERE status NOT IN ('recovered', 'refunded', 'exhausted')
           ORDER BY created_at ASC`
        )
        .all();
    }
    return db
      .prepare(
        `SELECT * FROM payments
         WHERE status NOT IN ('recovered', 'refunded', 'exhausted')
           AND COALESCE(is_simulated, 0) = 0
         ORDER BY created_at ASC`
      )
      .all();
  },

  updateStatus(payment_id, status, extra = {}) {
    const fields = ['status = @status'];
    const params = { payment_id, status };
    for (const [k, v] of Object.entries(extra)) {
      fields.push(`${k} = @${k}`);
      params[k] = v;
    }
    return db
      .prepare(`UPDATE payments SET ${fields.join(', ')} WHERE payment_id = @payment_id`)
      .run(params);
  },

  updateClassification(payment_id, classification, priority_score = null) {
    return db
      .prepare(
        `UPDATE payments SET classification = ?, priority_score = ? WHERE payment_id = ?`
      )
      .run(classification, priority_score, payment_id);
  },

  resetForCompare() {
    db.prepare(
      `UPDATE payments SET
        status = 'failed',
        next_attempt_at = NULL,
        attempts_made = 0,
        promised_date = NULL
       WHERE status IN ('recovered', 'exhausted', 'promise_to_pay', 'deferred', 'link_sent', 'retrying')`
    ).run();
    db.prepare('DELETE FROM recovery_outcomes').run();
    db.prepare(
      `DELETE FROM action_log WHERE action_type NOT IN ('classify')`
    ).run();
  },

  metrics() {
    // Core merchant only — matches At Risk / Recovered cards on the dashboard
    const atRisk = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as total FROM payments
         WHERE status NOT IN ('recovered', 'refunded')
           AND COALESCE(is_simulated, 0) = 0`
      )
      .get().total;
    const recovered = db
      .prepare(
        `SELECT COALESCE(SUM(r.recovered_amount),0) as total
         FROM recovery_outcomes r
         JOIN payments p ON p.payment_id = r.payment_id
         WHERE r.recovered = 1 AND COALESCE(p.is_simulated, 0) = 0`
      )
      .get().total;
    const recoveredCount = db
      .prepare(
        `SELECT COUNT(*) as c
         FROM recovery_outcomes r
         JOIN payments p ON p.payment_id = r.payment_id
         WHERE r.recovered = 1 AND COALESCE(p.is_simulated, 0) = 0`
      )
      .get().c;
    const totalCore = db
      .prepare(
        `SELECT COUNT(*) as c FROM payments WHERE COALESCE(is_simulated, 0) = 0`
      )
      .get().c;
    const avgTime = db
      .prepare(
        `SELECT AVG(
          (julianday(recovered_at) - julianday(p.created_at)) * 24
         ) as hours
         FROM recovery_outcomes r
         JOIN payments p ON p.payment_id = r.payment_id
         WHERE r.recovered = 1 AND r.recovered_at IS NOT NULL
           AND COALESCE(p.is_simulated, 0) = 0`
      )
      .get().hours;

    const denomAmount = atRisk + recovered;
    const recoveryRateByAmount =
      denomAmount > 0 ? Math.round((recovered / denomAmount) * 1000) / 10 : 0;
    const recoveryRateByCount =
      totalCore > 0 ? Math.round((recoveredCount / totalCore) * 1000) / 10 : 0;

    return {
      atRiskAmount: Math.round(atRisk),
      recoveredAmount: Math.round(recovered),
      /** Headline rate = recovered ₹ ÷ (at-risk ₹ + recovered ₹) — matches the ₹ cards */
      recoveryRate: recoveryRateByAmount,
      recoveryRateByAmount,
      recoveryRateByCount,
      avgTimeHours: avgTime ? Math.round(avgTime * 10) / 10 : 0,
      totalPayments: totalCore,
      recoveredCount,
    };
  },
};

export const actionLog = {
  insert({
    payment_id,
    action_type,
    channel = null,
    justification = '',
    outcome = null,
    budget_window_id = null,
    timestamp = null,
  }) {
    return db
      .prepare(
        `INSERT INTO action_log
         (payment_id, action_type, channel, timestamp, justification, outcome, budget_window_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payment_id,
        action_type,
        channel,
        timestamp || now(),
        justification,
        outcome,
        budget_window_id
      );
  },

  recent(limit = 50) {
    return db
      .prepare(`SELECT * FROM action_log ORDER BY action_id DESC LIMIT ?`)
      .all(limit);
  },

  listAll(filters = {}) {
    let sql = 'SELECT * FROM action_log WHERE 1=1';
    const params = [];
    if (filters.payment_id) {
      sql += ' AND payment_id = ?';
      params.push(filters.payment_id);
    }
    if (filters.action_type) {
      sql += ' AND action_type = ?';
      params.push(filters.action_type);
    }
    if (filters.outcome) {
      sql += ' AND outcome = ?';
      params.push(filters.outcome);
    }
    sql += ' ORDER BY action_id DESC LIMIT 500';
    return db.prepare(sql).all(...params);
  },

  historyForPayment(payment_id) {
    return db
      .prepare(`SELECT * FROM action_log WHERE payment_id = ? ORDER BY action_id ASC`)
      .all(payment_id);
  },

  /** Latest preemptive_nudge for a subscription (matched via justification text) */
  latestPreemptiveNudge(subscription_id) {
    return db
      .prepare(
        `SELECT * FROM action_log
         WHERE action_type = 'preemptive_nudge'
           AND justification LIKE ?
         ORDER BY action_id DESC
         LIMIT 1`
      )
      .get(`%${subscription_id}%`);
  },
};

export const recoveryOutcomes = {
  upsert({ payment_id, recovered, recovered_amount, recovered_at, tactic_used, attempts_made }) {
    return db
      .prepare(
        `INSERT INTO recovery_outcomes
         (payment_id, recovered, recovered_amount, recovered_at, tactic_used, attempts_made)
         VALUES (@payment_id, @recovered, @recovered_amount, @recovered_at, @tactic_used, @attempts_made)
         ON CONFLICT(payment_id) DO UPDATE SET
           recovered = @recovered,
           recovered_amount = @recovered_amount,
           recovered_at = @recovered_at,
           tactic_used = @tactic_used,
           attempts_made = @attempts_made`
      )
      .run({
        payment_id,
        recovered: recovered ? 1 : 0,
        recovered_amount: recovered_amount || 0,
        recovered_at: recovered_at || null,
        tactic_used: tactic_used || null,
        attempts_made: attempts_made || 0,
      });
  },

  getById(payment_id) {
    return db.prepare('SELECT * FROM recovery_outcomes WHERE payment_id = ?').get(payment_id);
  },

  listAll() {
    return db.prepare('SELECT * FROM recovery_outcomes').all();
  },
};

export const banditState = {
  get(segment) {
    return db.prepare('SELECT * FROM bandit_state WHERE segment = ?').get(segment);
  },

  upsert(segment, success_count, attempt_count, weight) {
    return db
      .prepare(
        `INSERT INTO bandit_state (segment, success_count, attempt_count, current_allocation_weight)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(segment) DO UPDATE SET
           success_count = excluded.success_count,
           attempt_count = excluded.attempt_count,
           current_allocation_weight = excluded.current_allocation_weight`
      )
      .run(segment, success_count, attempt_count, weight);
  },

  listAll() {
    return db.prepare('SELECT * FROM bandit_state').all();
  },
};

export const insightsDb = {
  insert({ pattern_description, affected_count, suggested_fix }) {
    return db
      .prepare(
        `INSERT INTO insights (pattern_description, affected_count, suggested_fix, generated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(pattern_description) DO UPDATE SET
           affected_count = excluded.affected_count,
           suggested_fix = excluded.suggested_fix,
           generated_at = excluded.generated_at`
      )
      .run(pattern_description, affected_count, suggested_fix, now());
  },

  clear() {
    db.prepare('DELETE FROM insights').run();
  },

  listAll() {
    return db.prepare('SELECT * FROM insights ORDER BY affected_count DESC, insight_id DESC').all();
  },

  findByPattern(pattern_description) {
    return db
      .prepare('SELECT * FROM insights WHERE pattern_description = ?')
      .get(pattern_description);
  },
};

export const networkEvents = {
  insert({ bank_gateway, affected_merchant_ids, failure_rate_delta, status, justification }) {
    const merchants =
      typeof affected_merchant_ids === 'string'
        ? affected_merchant_ids
        : JSON.stringify(affected_merchant_ids);
    return db
      .prepare(
        `INSERT INTO network_events
         (bank_gateway, affected_merchant_ids, failure_rate_delta, status, timestamp, justification)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(bank_gateway, merchants, failure_rate_delta, status, now(), justification);
  },

  listAll() {
    return db.prepare('SELECT * FROM network_events ORDER BY event_id DESC').all();
  },

  /** Latest event per bank+status pair — prevents duplicate alert cards */
  listLatestPerBank() {
    return db
      .prepare(
        `SELECT ne.* FROM network_events ne
         INNER JOIN (
           SELECT bank_gateway, status, MAX(event_id) as max_id
           FROM network_events
           GROUP BY bank_gateway, status
         ) latest ON ne.event_id = latest.max_id
         ORDER BY ne.event_id DESC`
      )
      .all();
  },

  activeFlag(bank_gateway) {
    const flagged = db
      .prepare(
        `SELECT * FROM network_events
         WHERE bank_gateway = ? AND status = 'flagged'
         ORDER BY event_id DESC LIMIT 1`
      )
      .get(bank_gateway);
    if (!flagged) return null;
    const resumed = db
      .prepare(
        `SELECT * FROM network_events
         WHERE bank_gateway = ? AND status = 'resumed' AND event_id > ?
         ORDER BY event_id DESC LIMIT 1`
      )
      .get(bank_gateway, flagged.event_id);
    return resumed ? null : flagged;
  },
};

export const customerHistory = {
  upsert(customer_name, relationship_months, total_past_payments) {
    return db
      .prepare(
        `INSERT INTO customer_history (customer_name, relationship_months, total_past_payments)
         VALUES (?, ?, ?)
         ON CONFLICT(customer_name) DO UPDATE SET
           relationship_months = excluded.relationship_months,
           total_past_payments = excluded.total_past_payments`
      )
      .run(customer_name, relationship_months, total_past_payments);
  },

  get(customer_name) {
    return db.prepare('SELECT * FROM customer_history WHERE customer_name = ?').get(customer_name);
  },

  listAll() {
    return db.prepare('SELECT * FROM customer_history').all();
  },
};

export const predictionsDb = {
  get(subscription_id) {
    return db
      .prepare('SELECT * FROM at_risk_predictions WHERE subscription_id = ?')
      .get(subscription_id);
  },

  upsert({ subscription_id, customer_name, risk_level, reason }) {
    const existing = this.get(subscription_id);
    // Idempotent: skip write if same active prediction (subscription + risk + reason)
    if (
      existing &&
      existing.risk_level === risk_level &&
      existing.reason === reason
    ) {
      return { changes: 0, skipped: true, existing };
    }
    return db
      .prepare(
        `INSERT INTO at_risk_predictions
         (subscription_id, customer_name, risk_level, reason, predicted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(subscription_id) DO UPDATE SET
           customer_name = excluded.customer_name,
           risk_level = excluded.risk_level,
           reason = excluded.reason,
           predicted_at = excluded.predicted_at`
      )
      .run(subscription_id, customer_name, risk_level, reason, now());
  },

  clear() {
    db.prepare('DELETE FROM at_risk_predictions').run();
  },

  listAtRisk() {
    return db
      .prepare(
        `SELECT * FROM at_risk_predictions
         WHERE risk_level IN ('HIGH', 'MEDIUM')
         ORDER BY CASE risk_level WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                  prediction_id ASC`
      )
      .all();
  },

  listAll() {
    return db.prepare('SELECT * FROM at_risk_predictions ORDER BY prediction_id').all();
  },
};

export const subscriptionsDb = {
  upsert(row) {
    return db
      .prepare(
        `INSERT INTO active_subscriptions
         (subscription_id, customer_name, amount, card_expiry_date, recent_late_charges, merchant_id)
         VALUES (@subscription_id, @customer_name, @amount, @card_expiry_date, @recent_late_charges, @merchant_id)
         ON CONFLICT(subscription_id) DO UPDATE SET
           customer_name = excluded.customer_name,
           amount = excluded.amount,
           card_expiry_date = excluded.card_expiry_date,
           recent_late_charges = excluded.recent_late_charges,
           merchant_id = excluded.merchant_id`
      )
      .run({
        merchant_id: 'merchant_demo_1',
        recent_late_charges: 0,
        card_expiry_date: null,
        ...row,
      });
  },

  listAll() {
    return db.prepare('SELECT * FROM active_subscriptions').all();
  },

  clear() {
    db.prepare('DELETE FROM active_subscriptions').run();
  },
};

export const batchProgress = {
  set(data) {
    db.prepare(
      `INSERT INTO batch_progress (id, naive_json, optimized_json, phase, updated_at)
       VALUES (1, @naive_json, @optimized_json, @phase, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         naive_json = @naive_json,
         optimized_json = @optimized_json,
         phase = @phase,
         updated_at = @updated_at`
    ).run({
      naive_json: data.naive ? JSON.stringify(data.naive) : null,
      optimized_json: data.optimized ? JSON.stringify(data.optimized) : null,
      phase: data.phase || null,
      updated_at: now(),
    });
  },

  get() {
    const row = db.prepare('SELECT * FROM batch_progress WHERE id = 1').get();
    if (!row) return null;
    return {
      phase: row.phase,
      updated_at: row.updated_at,
      naive: row.naive_json ? JSON.parse(row.naive_json) : null,
      optimized: row.optimized_json ? JSON.parse(row.optimized_json) : null,
    };
  },
};
