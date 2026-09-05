import { Router } from 'express';
import { payments, actionLog, networkEvents, batchProgress, insightsDb } from '../db/queries.js';
import { runClassification } from '../classifier/run-classification.js';
import { runBatch, runCompare, projectSandbox } from '../engine/runBatch.js';
import { detectPromiseIntent, recordPromise } from '../recovery/promiseToPay.js';
import { generateInsights, explainNetworkAlert } from '../insights/generateInsights.js';
import {
  verifyWebhookSignature,
  handleRazorpayWebhook,
} from '../webhooks/razorpayWebhook.js';
import { detectOutage, checkResume, forceResume } from '../network/outageDetector.js';
import { dispatchPayment } from '../recovery/dispatcher.js';
import { listAtRiskPredictions, runPredictions } from '../prediction/predictRisk.js';
import config from '../config.js';
import { sendError } from '../utils/errors.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Recovery Yield Optimizer',
    track: 'AI Revenue Recovery (Track 3)',
    framing: 'revenue recovery optimization — not fraud detection',
  });
});

router.get('/metrics', (_req, res) => {
  res.json(payments.metrics());
});

router.get('/payments', (req, res) => {
  res.json(payments.listAll(req.query));
});

router.get('/payments/:id', (req, res) => {
  const p = payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({
    payment: p,
    history: actionLog.historyForPayment(req.params.id),
  });
});

router.post('/payments/:id/customer-reply', (req, res) => {
  const { text } = req.body || {};
  const p = payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!detectPromiseIntent(text)) {
    return res.json({ promiseDetected: false, message: 'No PTP intent detected' });
  }
  const result = recordPromise(req.params.id, text);
  res.json({ promiseDetected: true, ...result });
});

router.post('/classify', (_req, res) => {
  res.json(runClassification());
});

router.post('/batch/run', async (req, res) => {
  try {
    const mode = req.query.mode === 'naive' ? 'naive' : 'optimized';
    const budget = Number(req.query.budget || req.body?.budget) || config.BUDGET_PER_WINDOW;
    const aggressiveness = Number(req.query.aggressiveness ?? req.body?.aggressiveness ?? 0.5);
    const summary = await runBatch(mode, { budget, aggressiveness });
    res.json(summary);
  } catch (err) {
    return sendError(res, 500, 'batch_run_failed', err);
  }
});

router.post('/batch/compare', async (req, res) => {
  try {
    const budget = Number(req.body?.budget) || config.BUDGET_PER_WINDOW;
    const aggressiveness = Number(req.body?.aggressiveness ?? 0.5);
    runCompare({ budget, aggressiveness }).catch((e) =>
      console.error('compare error', e)
    );
    res.json({ started: true, poll: '/api/batch/progress' });
  } catch (err) {
    return sendError(res, 500, 'batch_compare_failed', err);
  }
});

router.get('/batch/compare', async (req, res) => {
  try {
    const budget = Number(req.query.budget) || config.BUDGET_PER_WINDOW;
    const result = await runCompare({ budget });
    res.json(result);
  } catch (err) {
    return sendError(res, 500, 'batch_compare_failed', err);
  }
});

router.get('/batch/progress', (_req, res) => {
  res.json(batchProgress.get() || { phase: 'idle' });
});

router.get('/actions/recent', (req, res) => {
  const limit = Number(req.query.limit) || 40;
  res.json(actionLog.recent(limit));
});

router.get('/actions', (req, res) => {
  res.json(actionLog.listAll(req.query));
});

router.get('/insights', async (_req, res) => {
  let rows = insightsDb.listAll();
  if (!rows.length) {
    await generateInsights();
    rows = insightsDb.listAll();
  }
  // Defensive dedupe by pattern_description
  const seen = new Set();
  res.json(
    rows.filter((r) => {
      if (seen.has(r.pattern_description)) return false;
      seen.add(r.pattern_description);
      return true;
    })
  );
});

router.post('/insights/regenerate', async (_req, res) => {
  const rows = await generateInsights();
  res.json(rows);
});

router.get('/sandbox/project', (req, res) => {
  const aggressiveness = Number(req.query.aggressiveness ?? 0.5);
  const budget = Number(req.query.budget ?? 20);
  res.json(projectSandbox({ aggressiveness, budget }));
});

router.get('/network/events', async (_req, res) => {
  // Read-only listing — do NOT re-run detect on every poll (avoids duplicate cards).
  // Detection happens via POST /network/detect.
  const events = networkEvents.listLatestPerBank();
  const enriched = await Promise.all(
    events.map(async (e) => {
      let merchants = [];
      try {
        merchants = JSON.parse(e.affected_merchant_ids);
      } catch {
        merchants = [];
      }
      const explanation = await explainNetworkAlert({
        bank_gateway: e.bank_gateway,
        merchantCount: merchants.length,
        failure_rate_delta: e.failure_rate_delta,
      });
      return { ...e, affected_merchants: merchants, explanation };
    })
  );
  res.json(enriched);
});

router.post('/network/detect', (_req, res) => {
  const flagged = detectOutage();
  const resumed = checkResume();
  res.json({ flagged, resumed, events: networkEvents.listLatestPerBank() });
});

router.post('/network/resume/:bank', (req, res) => {
  forceResume(req.params.bank);
  res.json({ ok: true, events: networkEvents.listLatestPerBank() });
});

router.get('/predictions/at-risk', (_req, res) => {
  let rows = listAtRiskPredictions();
  if (!rows.length) {
    runPredictions({ sendPreemptive: false });
    rows = listAtRiskPredictions();
  }
  res.json(rows);
});

router.post('/predictions/run', (_req, res) => {
  const results = runPredictions({ sendPreemptive: true });
  res.json(results);
});

router.post('/explain', async (req, res) => {
  try {
    const { explainQuestion } = await import('../insights/explainChat.js');
    const question = req.body?.question || '';
    const result = await explainQuestion(question);
    res.json(result);
  } catch (err) {
    return sendError(res, 500, 'explain_failed', err);
  }
});

router.post('/dev/reset-demo', async (_req, res) => {
  if (!config.DEMO_RESET_ENABLED) {
    return res.status(403).json({ error: 'demo_reset_disabled' });
  }
  try {
    const { resetDemoScenario } = await import('../dev/resetDemo.js');
    const summary = await resetDemoScenario();
    res.json({ ok: true, ...summary });
  } catch (err) {
    return sendError(res, 500, 'demo_reset_failed', err);
  }
});

router.post('/payments/:id/dispatch', async (req, res) => {
  const p = payments.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const result = await dispatchPayment(p, { budgetWindowId: 'manual' });
  res.json(result);
});

/**
 * Razorpay webhooks: verify signature FIRST, then ack, then process.
 * Never processes payload on failed/missing verification.
 */
router.post('/webhooks/razorpay', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error('webhook rejected: RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }

  const signature = req.headers['x-razorpay-signature'];
  const raw = req.rawBody;
  if (!raw || !verifyWebhookSignature(raw, signature, secret)) {
    console.error('webhook rejected: invalid or missing signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  // Signature OK — acknowledge quickly, then process
  res.status(200).json({ status: 'ok' });
  try {
    handleRazorpayWebhook(req.body);
  } catch (err) {
    console.error('webhook process error', err?.stack || err?.message || err);
  }
});

router.get('/config', (_req, res) => {
  res.json({
    BUDGET_PER_WINDOW: config.BUDGET_PER_WINDOW,
    QUIET_HOURS_START: config.QUIET_HOURS_START,
    QUIET_HOURS_END: config.QUIET_HOURS_END,
    MAX_RETRY_ATTEMPTS: config.MAX_RETRY_ATTEMPTS,
    OUTAGE_THRESHOLD_MULTIPLIER: config.OUTAGE_THRESHOLD_MULTIPLIER,
    DEMO_RESET_ENABLED: config.DEMO_RESET_ENABLED,
    RAZORPAY_SANDBOX_MODE: config.RAZORPAY_SANDBOX_MODE,
  });
});

export default router;
