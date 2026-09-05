# Cursor Agent Build Guide — Recovery Yield Optimizer (Final)

Copy-paste-ready prompts for Cursor's agent, in order. Do one step, verify it, then move to the next. All 17 steps map to `SRS_Recovery_Yield_Optimizer.md` (see SRS §12).

---

## 0. Before you start
- Empty repo/folder open in Cursor.
- Razorpay test-mode Key ID + Secret ready.
- Stack: **Node.js + Express + SQLite + React/Tailwind**.
- Put `SRS_Recovery_Yield_Optimizer.md` in repo root — `@`-mention it in prompts so the agent stays grounded in spec, not guesses.
- **Reminder for every prompt involving Network Intelligence (Steps 16-17): explicitly tell the agent this is NOT fraud detection** — see SRS §1.2. Keep repeating this in prompts so the agent doesn't drift toward risk-scoring language/UI copy.

---

# PART A — CORE SYSTEM (Steps 1–13, Track 3 must-haves)

## Step 1 — Scaffold the project
```
@SRS_Recovery_Yield_Optimizer.md

I'm building "Recovery Yield Optimizer" — an AI agent for Razorpay's AI Revenue
Recovery track. Read the SRS, especially §1.2 (track positioning — this is
revenue recovery, NOT fraud/risk detection, keep that framing everywhere).

Scaffold a monorepo:

/backend
  /src
    /db          -> SQLite setup + schema
    /webhooks    -> Razorpay webhook handlers
    /classifier  -> failure classification rules
    /engine      -> triage queue, priority scoring, budget logic
    /bandit      -> tactic selection (epsilon-greedy)
    /recovery    -> action executors
    /insights    -> leak-to-fix pattern detection
    /network     -> (for later) multi-merchant outage detection
    /routes      -> REST API
    server.js
  package.json
  .env.example

/frontend
  (Vite + React + Tailwind app)
  /src
    /components
    /pages
  package.json

/scripts
  seed-data.js          -> single-merchant synthetic batch
  seed-network-data.js  -> (for later) multi-merchant simulated batch

README.md

Use Express, better-sqlite3, Vite+React+Tailwind. Just scaffold folders with
TODO comments referencing the SRS section they implement, plus a working
health-check route + blank dashboard page that fetches it.
```

## Step 2 — Database schema
```
In /backend/src/db, implement the schema from SRS §8.1:
- payments (payment_id PK, merchant_id, customer_name, amount, currency,
  status, failure_reason, type, bank_gateway, created_at, classification,
  priority_score)
- action_log (action_id PK autoincrement, payment_id FK, action_type, channel,
  timestamp, justification, outcome, budget_window_id)
- recovery_outcomes (payment_id FK, recovered, recovered_amount, recovered_at,
  tactic_used, attempts_made)
- bandit_state (segment PK, success_count, attempt_count, current_allocation_weight)
- insights (insight_id PK autoincrement, pattern_description, affected_count,
  suggested_fix, generated_at)
- network_events (event_id PK autoincrement, bank_gateway, affected_merchant_ids,
  failure_rate_delta, status, timestamp, justification)  -- used later in Step 16

Add query helpers (insert, getById, listAll, updateStatus) for each table using
better-sqlite3 synchronous API.
```

## Step 3 — Synthetic single-merchant data
```
Write /scripts/seed-data.js generating 80 synthetic failed payments (single
merchant_id='merchant_demo_1'):
- 40% [network_error, gateway_timeout] -> TRANSIENT
- 35% [card_expired, insufficient_funds] -> CARD_ISSUE
- 25% [mandate_not_approved, auth_failed], type=subscription only -> MANDATE_ISSUE
Amount: ₹199-₹9,999. Synthetic Indian names. created_at spread across last 7
days. type: 70% one_time, 30% subscription. Include a bank_gateway field
(random from [HDFC, ICICI, SBI, Axis, Kotak]). Runnable via
`node scripts/seed-data.js --reset`.
```

## Step 4 — Classifier
```
Implement /backend/src/classifier/classify.js per SRS FR-2.
classifyFailure(failure_reason, type) returns { classification, rule } where
rule is a human-readable audit string.
Rules: network_error/gateway_timeout -> TRANSIENT; card_expired/
insufficient_funds -> CARD_ISSUE; mandate_not_approved/auth_failed (subscription
only) -> MANDATE_ISSUE; unrecognized -> CARD_ISSUE with "defaulted" note.
Add /backend/src/classifier/run-classification.js to classify all unclassified
rows and log each to action_log (action_type='classify').
```

## Step 5 — Priority scoring + triage queue
```
Implement /backend/src/engine/priorityQueue.js per SRS FR-3.
priorityScore(payment) = estimatedRecoveryProbability(classification) * amount
  - fatiguePenalty(payment)
Priors: TRANSIENT 0.7, CARD_ISSUE 0.4, MANDATE_ISSUE 0.3. fatiguePenalty = flat 5.

buildTriageQueue(mode: 'naive'|'optimized'):
- naive: unresolved payments sorted by created_at ascending, no budget
- optimized: sorted by priorityScore descending, truncated to config.BUDGET_PER_WINDOW

Create /backend/src/config.js exporting BUDGET_PER_WINDOW=20,
QUIET_HOURS_START=9, QUIET_HOURS_END=21, MAX_RETRY_ATTEMPTS=3,
OUTAGE_THRESHOLD_MULTIPLIER=3 (used later in Step 16).
```

## Step 6 — Bandit tactic selection
```
Implement /backend/src/bandit/epsilonGreedy.js per SRS FR-4.
Channels for CARD_ISSUE: ['sms_link', 'whatsapp_link', 'hinglish_nudge'].
selectChannel(classification): 90% pick highest current_allocation_weight
(exploit), 10% random (explore). Initialize equal weights if segment unseen.
recordOutcome(classification, channel, recovered): update bandit_state,
weight = (success_count+1)/(attempt_count+2).
Only for CARD_ISSUE.
```

## Step 7 — Recovery executors with stopping rules
```
Implement /backend/src/recovery/ per SRS FR-5, NFR-2. Every action must write
to action_log with a justification, including skipped/error paths.

1. retryTransient(payment) — up to MAX_RETRY_ATTEMPTS with backoff
   [immediate, 1hr, 6hr] (simulate via next_attempt_at timestamp, not real
   sleep). Call Razorpay test-mode API or simulate outcome if
   RAZORPAY_SANDBOX_MODE=simulate. Mark 'recovered' or 'exhausted'.

2. sendPaymentLink(payment) — bandit.selectChannel picks channel, generate
   Razorpay test-mode Payment Link, check quiet hours (defer+log if outside),
   log the "sent" message content, max 1 follow-up after 24h, call
   bandit.recordOutcome on result.

3. retryMandate(payment) — same pattern, capped at MAX_RETRY_ATTEMPTS.

4. dispatcher.js — routes by classification; hard guard refuses to act on
   'recovered'/'refunded'/'exhausted' payments, logs 'skipped_terminal_state'.

Wrap every executor in try/catch — on error, log outcome='error' and continue
to next payment, never crash the batch.
```

## Step 8 — Promise-to-pay tracker
```
Implement /backend/src/recovery/promiseToPay.js per SRS FR-6.
detectPromiseIntent(text) -> boolean, matching ["kal","tomorrow","pay later",
"next week","will pay"] case-insensitive.
recordPromise(payment_id, promisedDateText): parse rough date (default +1 day),
set status='promise_to_pay', schedule one scheduled_followup action_log entry,
suppress further recovery until that date (dispatcher.js must check this
status and skip).
Add POST /api/payments/:id/customer-reply { text }.
```

## Step 9 — Batch runner
```
Implement /backend/src/engine/runBatch.js per SRS FR-3/FR-8.2.
runBatch(mode): build triage queue, dispatch each payment (respecting budget
if optimized), return { mode, totalProcessed, totalRecoveredAmount,
totalAtRiskAmount, recoveryRate, actionsUsed }.
Add POST /api/batch/run?mode=naive|optimized.
Add GET /api/batch/compare: reset payment statuses, run naive, capture,
reset again, run optimized, capture, return both summaries side by side.
Make the comparison progressive if possible (emit intermediate state via
polling endpoint or SSE) so the frontend chart can animate rather than jump
straight to the final numbers — see SRS FR-8.2.
```

## Step 10 — Leak-to-Fix insights
```
Implement /backend/src/insights/generateInsights.js per SRS FR-9.
aggregatePatterns(): find failure-reason concentration by hour-of-day and by
day-of-month. Return [{ pattern_description, affected_count }].
generateSummary(pattern): call Anthropic API (model "claude-sonnet-4-6") if
ANTHROPIC_API_KEY set, else static template fallback — must not crash if
LLM unavailable (NFR-4).
Store in insights table, expose GET /api/insights.
```

## Step 11 — Dashboard (core)
```
Build the React dashboard in /frontend/src per SRS FR-8. Sections:
1. Metrics bar: 4 cards (At Risk ₹, Recovered ₹, Recovery Rate %, Avg Time)
2. Comparison chart (recharts bar chart): naive vs optimized ₹ recovered per
   actions used, animating progressively as the batch runs, not a static jump
   — fetch from GET /api/batch/compare with polling for intermediate state
3. Live action feed: poll GET /api/actions/recent every 2s during a run
4. Audit table: filterable by payment_id, action_type, outcome; click to
   expand full history
5. Insights panel: cards from GET /api/insights

Clean, minimal, dark-mode friendly. Reserve space/layout for a "Network
Alerts" panel and a "Policy Sandbox" section that will be added in Steps 15-16
— don't build them yet, just leave clean layout slots.
```

## Step 12 — Real Razorpay webhook
```
Implement /backend/src/webhooks/razorpayWebhook.js per SRS §7.1.
POST /api/webhooks/razorpay: verify signature via RAZORPAY_WEBHOOK_SECRET
(HMAC SHA256). On 'payment.failed': insert payment, classify immediately.
On 'subscription.charged.failed': same, type='subscription'. Respond 200 fast,
process after ack.
Add README instructions: expose localhost via ngrok, register webhook +
these two events in Razorpay test-mode dashboard.
```

## Step 13 — Core polish pass
```
1. Add React error boundaries so one failed fetch doesn't blank the dashboard.
2. Add loading skeletons for metrics bar and comparison chart.
3. README sections: "How to run" and a draft "Demo script" (fill in fully
   after Steps 14-17 are done).
4. Verify every recovery executor path (including skipped/error) writes to
   action_log — audit completeness matters for judging.
```

**Checkpoint: this is your fully working core Track 3 submission.** Everything below is the advanced/differentiator layer — build it only after Step 13 works end-to-end.

---

# PART B — ADVANCED LAYER (Steps 14–15)

## Step 14 — Salary-date-aware retry
```
Implement salary-date scheduling per SRS FR-10, inside
/backend/src/recovery/sendPaymentLink.js (or a new
/backend/src/recovery/salaryDateScheduler.js used by it).

For CARD_ISSUE payments where failure_reason='insufficient_funds':
1. Check simulated historical recovery-success-by-day-of-month data (you can
   seed a small static lookup table for demo purposes: success rate is 3x
   higher on days 1-3 and 28-31 of the month vs other days).
2. If not within that window, schedule the retry/message for the next
   occurrence of that window instead of the default fixed backoff, still
   respecting MAX_RETRY_ATTEMPTS.
3. Log the decision with justification, e.g. "scheduled for day 1: insufficient
   funds recovery rate 3.2x higher near salary date" — write this to
   action_log exactly as specified in FR-10.3.

Add a small badge/tag in the dashboard audit table for entries using this
scheduling logic, so it's visible in the demo.
```

## Step 15 — Interactive Policy Sandbox
```
Implement per SRS FR-11.

Backend: add GET /api/sandbox/project?aggressiveness=X&budget=Y that reuses
the existing priorityQueue logic (Step 5) against the CURRENT payments batch
to compute a projection: { projectedRecoveredAmount, projectedActionsUsed,
estimatedFatigueScore } WITHOUT executing any real actions or writing to
action_log — read-only projection per FR-11.3.

fatigue score: simple function of (actions_used / total_customers) weighted
by aggressiveness.

Frontend: add two sliders to the dashboard — "Aggressiveness" (gentle <-> 
aggressive) and "Budget per hour" (10-50). On change (debounced ~300ms), call
the projection endpoint and update a small results panel live: "At this
setting: ₹X recoverable, Y messages, fatigue score Z." Must respond within
2s (NFR-3). Clearly label this panel "Live Projection — not yet executed" so
it's visually distinct from the real batch-run results in Step 11.

Add a separate "Run with these settings" button that actually triggers
POST /api/batch/run with the chosen budget as a real execution — keeping
projection and execution clearly separate per FR-11.3.
```

---

# PART C — NETWORK INTELLIGENCE LAYER (Steps 16–17)

**Before starting: re-read SRS §1.2 and §5. Every prompt below must keep the "recovery optimization, not fraud detection" framing. If Cursor's agent generates UI copy like "fraud alert" or "risk score," correct it immediately — this protects your track positioning.**

## Step 16 — Multi-merchant simulated data + outage detection
```
@SRS_Recovery_Yield_Optimizer.md — read §5 (FR-12, FR-13, FR-14) before starting.
This module detects bank/gateway-wide outages to avoid wasting retry budget
on doomed payments — it is explicitly NOT fraud or risk detection. Do not use
that language anywhere in code comments, variable names, or UI copy.

1. Write /scripts/seed-network-data.js generating a simulated multi-merchant
   batch: 8 merchants (merchant_demo_2 through merchant_demo_9), ~15-20 failed
   payments each, spread over a simulated recent time window. Engineer ONE
   deliberate outage scenario: at a specific simulated timestamp, HDFC's
   failure rate across at least 3 of these merchants spikes to 3x+ their
   baseline for a ~15 minute simulated window, then returns to normal.
   Clearly mark these rows as simulated (a `is_simulated=true` flag).

2. Implement /backend/src/network/outageDetector.js per FR-13:
   - computeRollingFailureRate(bank_gateway, windowMinutes) across all
     merchants for that bank/gateway
   - detectOutage(): compare current rate vs baseline using
     config.OUTAGE_THRESHOLD_MULTIPLIER; if exceeded, insert a network_events
     row (status='flagged') with affected_merchant_ids and failure_rate_delta
   - checkResume(): if a flagged bank/gateway's rate has normalized, insert a
     network_events row (status='resumed')

3. Update dispatcher.js (from Step 7): before executing TRANSIENT retries or
   CARD_ISSUE payment-link sends, check if that payment's bank_gateway has an
   active 'flagged' network_event with no later 'resumed' event. If so, skip
   with action_log outcome='paused_network_outage' and a justification citing
   the network_event.

4. Add GET /api/network/events to expose network_events for the dashboard.
```

## Step 17 — Network Alerts panel + explainability
```
Build the "Network Alerts" panel in the dashboard slot reserved in Step 11,
per SRS FR-13.4 and FR-14.

- Poll GET /api/network/events, show active/flagged events distinctly
  (different color/section per NFR-6) from routine audit entries.
- Each alert card shows: bank/gateway name, number of affected merchants,
  failure-rate delta, current status (paused/resumed), and one explanation
  line per FR-14.1, e.g. "Only visible because 3 unrelated merchants share
  this pattern — no single merchant's data would show this."
- If ANTHROPIC_API_KEY is set, generate that explanation line via LLM (short
  prompt, one sentence); otherwise use a templated fallback — must not crash
  if unavailable.
- Add a clearly labeled "(Simulated multi-merchant data)" note near this
  panel per NFR-5, so it's honest about what's real vs simulated in the demo.
- Do NOT add any risk score, fraud flag, or similar language anywhere in this
  panel — keep it strictly about pause/resume of recovery actions.
```

---

# PART D — FINAL POLISH

## Step 18 — Full-system polish + demo readiness
```
1. Run through SRS §11 Acceptance Criteria (Core + Advanced + Track integrity)
   as a checklist against the running app — fix any gaps.
2. Finalize README: "How to run," full demo script (see
   Implementation_Roadmap.md demo script section), and a short "What track
   this solves" paragraph using the framing from SRS §1.2 verbatim-adjacent.
3. Do one full run-through: seed-data -> seed-network-data -> start backend ->
   start frontend -> run batch/compare -> adjust policy sandbox -> confirm
   network alert triggers on the engineered outage scenario -> check audit
   table for all action types (retry, payment-link, mandate-retry, PTP,
   salary-date-scheduled, paused_network_outage, skipped_terminal_state).
4. Confirm no UI text, log message, or code comment anywhere uses
   fraud/risk-detection framing (grep for "fraud" and "risk score" across the
   repo as a final check).
```

---

## Notes for running the agent well
- Do steps in order; each depends on prior files existing.
- Run/verify after each step before stacking the next.
- If the agent overbuilds or drifts, add: `"Keep this minimal — hackathon timeline, don't add extra abstraction layers."`
- `config.js` is the single source of truth for all caps/budgets/thresholds.
- `.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (optional), `RAZORPAY_SANDBOX_MODE=simulate`.
- Part A (Steps 1-13) alone is a complete, submittable Track 3 project. Parts B and C are differentiators — build them only once Part A is verified working, per the Roadmap's cut-order guidance.
