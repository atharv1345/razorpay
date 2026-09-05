/**
 * Leak-to-Fix insights — SRS FR-9
 * Idempotent upserts; mutex against concurrent page-load races.
 */
import db from '../db/index.js';
import { insightsDb } from '../db/queries.js';

let generating = null;

export function aggregatePatterns() {
  // Prefer a single strong hour concentration to avoid near-duplicate cards
  const byHour = db
    .prepare(
      `SELECT failure_reason,
              CAST(strftime('%H', created_at) AS INTEGER) as hour,
              COUNT(*) as affected_count
       FROM payments
       WHERE COALESCE(is_simulated, 0) = 0 OR failure_reason = 'network_error'
       GROUP BY failure_reason, hour
       HAVING affected_count >= 8
       ORDER BY affected_count DESC
       LIMIT 3`
    )
    .all();

  const byDom = db
    .prepare(
      `SELECT failure_reason,
              CAST(strftime('%d', created_at) AS INTEGER) as day_of_month,
              COUNT(*) as affected_count
       FROM payments
       WHERE COALESCE(is_simulated, 0) = 0
       GROUP BY failure_reason, day_of_month
       HAVING affected_count >= 8
       ORDER BY affected_count DESC
       LIMIT 2`
    )
    .all();

  const patterns = [];
  const seen = new Set();

  for (const r of byHour) {
    const key = `${r.failure_reason}:hour:${r.hour}`;
    if (seen.has(r.failure_reason)) continue;
    seen.add(r.failure_reason);
    patterns.push({
      pattern_description: `${r.failure_reason} concentrates around hour ${r.hour}:00 (${r.affected_count} failures)`,
      affected_count: r.affected_count,
      kind: 'hour',
      failure_reason: r.failure_reason,
      dedupeKey: key,
    });
  }
  for (const r of byDom) {
    if (seen.has(r.failure_reason)) continue;
    seen.add(r.failure_reason);
    patterns.push({
      pattern_description: `${r.failure_reason} spikes on day ${r.day_of_month} of the month (${r.affected_count} failures)`,
      affected_count: r.affected_count,
      kind: 'dom',
      failure_reason: r.failure_reason,
    });
  }
  return patterns;
}

function staticSummary(pattern) {
  const fixes = {
    network_error:
      'Ask your acquirer for a status page webhook; auto-pause retries during confirmed gateway incidents.',
    gateway_timeout:
      'Increase client-side timeout slightly and enable idempotent retry only for confirmed timeouts.',
    card_expired:
      'Prompt card update 14 days before expiry on subscriptions; surface “update card” in the app.',
    insufficient_funds:
      'Shift debit attempts toward salary windows (1–3 & 28–31) and offer UPI fallback.',
    mandate_not_approved:
      'Send a one-tap mandate re-authorization before the renewal charge window.',
    auth_failed:
      'Reduce 3DS friction for returning customers; verify bank BIN health before charge.',
  };
  const fix =
    fixes[pattern.failure_reason] ||
    'Review the top failure reason weekly and add a preventive checkout fix.';
  return `Pattern: ${pattern.pattern_description}. Suggested fix: ${fix}`;
}

async function llmSummary(pattern) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `You help merchants stop payment revenue leaks. In one short paragraph, summarize this failure pattern and suggest one preventive fix (not fraud-related): ${pattern.pattern_description}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch {
    return null;
  }
}

export async function generateInsights() {
  if (generating) return generating;
  generating = (async () => {
    const patterns = aggregatePatterns();
    insightsDb.clear();
    const out = [];
    for (const pattern of patterns.slice(0, 4)) {
      const llm = await llmSummary(pattern);
      const suggested_fix = llm || staticSummary(pattern);
      insightsDb.insert({
        pattern_description: pattern.pattern_description,
        affected_count: pattern.affected_count,
        suggested_fix,
      });
      out.push({ ...pattern, suggested_fix });
    }
    return out;
  })();
  try {
    return await generating;
  } finally {
    generating = null;
  }
}

export async function explainNetworkAlert({ bank_gateway, merchantCount, failure_rate_delta }) {
  const fallback = `Only visible because ${merchantCount} unrelated merchants share this ${bank_gateway} pattern — no single merchant's data would show this.`;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 80,
        messages: [
          {
            role: 'user',
            content: `One sentence: explain why detecting a ${bank_gateway} payment outage (delta ${failure_rate_delta}x, ${merchantCount} merchants) requires cross-merchant platform data. Frame as recovery optimization, never fraud.`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export default { aggregatePatterns, generateInsights, explainNetworkAlert };
