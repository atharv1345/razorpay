/**
 * Read-only "Explain It To Me" Q&A over audit / network / insights data.
 * Never triggers recovery actions.
 * Prefers Groq (GROQ_API_KEY), then Anthropic, then raw template fallback.
 */
import {
  actionLog,
  networkEvents,
  insightsDb,
  payments,
  predictionsDb,
} from '../db/queries.js';

const PAY_ID_RE = /pay_demo_\d{3}|pay_[a-zA-Z0-9_]+/i;

const SYSTEM_PROMPT = `You are an audit explainer for a payment Recovery Yield Optimizer (revenue recovery, NOT fraud detection).
Answer the merchant's question ONLY using the provided logged data.
If the answer is not in the data, say exactly: "I don't have that information logged."
Do not invent actions, amounts, or outcomes.
Do not suggest triggering new recovery actions.
Keep answers concise (2-6 sentences) unless showing a short timeline.`;

function gatherContext(question) {
  const q = (question || '').toLowerCase();
  const payMatch = question.match(PAY_ID_RE);
  const chunks = [];

  if (payMatch) {
    const payment_id = payMatch[0];
    const payment = payments.getById(payment_id);
    const history = actionLog.historyForPayment(payment_id);
    chunks.push({
      type: 'payment',
      payment,
      history,
    });
    return { payment_id, chunks };
  }

  if (/outage|network|hdfc|pause|gateway|bank/.test(q)) {
    chunks.push({ type: 'network_events', rows: networkEvents.listLatestPerBank() });
  }
  if (/insight|leak|pattern|fix/.test(q)) {
    chunks.push({ type: 'insights', rows: insightsDb.listAll() });
  }
  if (/predict|at-risk|radar|expir|preemptive/.test(q)) {
    chunks.push({ type: 'predictions', rows: predictionsDb.listAtRisk() });
  }
  if (/whatsapp|sms|bandit|channel|nudge|relationship|repeat|clv/.test(q)) {
    chunks.push({
      type: 'recent_actions',
      rows: actionLog.recent(40).filter((a) =>
        /payment_link|priority_score|preemptive|salary|classify/.test(a.action_type)
      ),
    });
  }

  if (!chunks.length) {
    chunks.push({ type: 'recent_actions', rows: actionLog.recent(25) });
  }

  return { payment_id: null, chunks };
}

function templateAnswer(question, ctx) {
  const lines = [`Q: ${question}`, '', 'Matched logged data (no LLM key — raw fallback):', ''];
  for (const chunk of ctx.chunks) {
    lines.push(`--- ${chunk.type} ---`);
    if (chunk.type === 'payment') {
      lines.push(JSON.stringify(chunk.payment, null, 2));
      for (const h of chunk.history || []) {
        lines.push(`[${h.action_type}] ${h.outcome || ''} — ${h.justification}`);
      }
    } else {
      const rows = chunk.rows || [];
      if (!rows.length) lines.push('(none)');
      for (const r of rows.slice(0, 12)) {
        lines.push(
          r.justification ||
            r.suggested_fix ||
            r.pattern_description ||
            r.reason ||
            JSON.stringify(r)
        );
      }
    }
    lines.push('');
  }
  lines.push('I can only answer from logged data above.');
  return lines.join('\n');
}

function userPrompt(question, ctx) {
  const contextText = JSON.stringify(ctx.chunks, null, 2).slice(0, 12000);
  return `Question: ${question}\n\nLogged data:\n${contextText}`;
}

async function groqAnswer(question, ctx) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(question, ctx) },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Groq explain error', res.status, errText.slice(0, 200));
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('Groq explain failed', err.message);
    return null;
  }
}

async function anthropicAnswer(question, ctx) {
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
        max_tokens: 400,
        messages: [{ role: 'user', content: `${SYSTEM_PROMPT}\n\n${userPrompt(question, ctx)}` }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

async function llmAnswer(question, ctx) {
  const groq = await groqAnswer(question, ctx);
  if (groq) return { text: groq, provider: 'groq' };
  const anthropic = await anthropicAnswer(question, ctx);
  if (anthropic) return { text: anthropic, provider: 'anthropic' };
  return null;
}

export async function explainQuestion(question) {
  const ctx = gatherContext(question || '');
  const llm = await llmAnswer(question, ctx);
  return {
    question,
    payment_id: ctx.payment_id,
    answer: llm?.text || templateAnswer(question, ctx),
    grounded: true,
    source: llm ? llm.provider : 'template',
    readOnly: true,
  };
}

export default { explainQuestion, gatherContext };
