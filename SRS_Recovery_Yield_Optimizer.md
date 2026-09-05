# Software Requirements Specification (SRS)
## Recovery Yield Optimizer — AI-Powered Payment Recovery Agent

**Track:** AI Revenue Recovery (Track 3) — primary and only track
**Version:** 2.0 (Final, Consolidated)
**Date:** September 4, 2026

---

## 1. Introduction

### 1.1 Purpose
This document specifies the complete requirements for **Recovery Yield Optimizer**, an AI agent that detects at-risk revenue, prioritizes recovery under a budget, executes bounded recovery workflows, learns which tactics work per segment, detects network-wide (multi-merchant) failure patterns to make recovery smarter, and surfaces preventive insights.

### 1.2 Track Positioning (Read This First)
**This project solves Track 3: AI Revenue Recovery, exclusively.** Every feature in this document — including the Network Intelligence Layer described in Section 4 — exists to serve one goal: *recovering revenue that would otherwise be lost, more efficiently and intelligently than a naive system.*

The Network Intelligence Layer (§4.4) may resemble Track 2 (AI Risk Manager)'s "fraud-spike detector" example direction on the surface. **It is not.** Its purpose is explicitly recovery-optimization, not fraud/risk detection:
- It exists to prevent **wasted, doomed retries** during a bank/gateway outage (so budget isn't burned on payments that can't succeed right now)
- It does not classify transactions as fraudulent, score risk, or take any defense-only action
- Framing to use consistently in writeup/demo: *"We detect network-wide patterns so our recovery is smarter, not to catch fraud."*

This framing must be repeated in the demo script and README so judges never have to guess which track is being addressed.

### 1.3 Scope
The system operates on Razorpay **test-mode** APIs and synthetic data (including simulated multi-merchant data for §4.4). It will:
- Ingest failed-payment and failed-subscription events
- Classify the failure into an actionable root-cause bucket
- Score and prioritize failures for recovery under a fixed action budget (Expected-Value Triage Queue)
- Select and adapt recovery tactics per segment using bandit-style learning
- Execute bounded recovery actions with hard stopping rules
- Detect bank/gateway-wide outage patterns across simulated merchants and pause/resume retries accordingly
- Time insufficient-funds retries around salary-date patterns
- Offer a live, judge-adjustable "policy sandbox" for recovery aggressiveness/budget
- Track promises-to-pay and schedule compliant follow-ups
- Log every decision and action for audit purposes
- Present a dashboard comparing naive vs. optimized recovery performance
- Generate natural-language "Leak-to-Fix" insights

Out of scope: real production payment processing, real SMS/WhatsApp delivery (mocked/logged), real customer PII, live production merchant accounts, any offense-capable or fraud-classification logic.

### 1.4 Definitions
| Term | Meaning |
|---|---|
| TRANSIENT | Failure due to a temporary/network/bank-side glitch |
| CARD_ISSUE | Failure due to expired card or insufficient funds |
| MANDATE_ISSUE | Failure due to subscription/mandate authorization problems |
| Recovery Budget | Cap on number of outbound actions (messages/retries) allowed per time window |
| Promise-to-Pay (PTP) | Customer indicates intent to pay at a future date |
| Leak-to-Fix | Insight generated from aggregated failure patterns suggesting a preventive fix |
| Circuit Breaker | Temporary pause of retries for a specific bank/gateway when its failure rate spikes abnormally |
| Network Intelligence | Cross-merchant pattern detection possible only because the platform sees data across many merchants |

---

## 2. Overall Description

### 2.1 Product Perspective
A standalone web application: backend service (webhook listener + recovery engine + network intelligence module), a persistent data store, and a React dashboard including an interactive policy sandbox. Integrates with Razorpay's test-mode Payments, Subscriptions, and Payment Links APIs, and optionally an LLM API.

### 2.2 Product Functions (Summary)
1. Failure ingestion via webhook
2. Root-cause classification
3. Priority-score computation and budgeted triage queue
4. Bandit-based channel/tactic selection
5. Bounded recovery execution with stopping rules
6. Salary-date-aware retry timing for insufficient-funds cases
7. Bank/gateway outage detection (circuit breaker) across simulated multi-merchant data
8. Promise-to-pay tracking and follow-up scheduling
9. Full audit logging
10. Dashboard: metrics, live feed, naive-vs-optimized comparison, audit table, network alerts, interactive policy sandbox
11. Leak-to-Fix insight generation

### 2.3 User Classes
- **Merchant Ops Viewer**: views dashboard, recovered amounts, audit trail, insights, network alerts
- **System/Agent**: executes classification, prioritization, and recovery autonomously within bounds
- **Judge/Demo Operator**: uses the policy sandbox to live-adjust aggressiveness/budget and observe outcome changes

### 2.4 Operating Environment
- Backend: Node.js (Express) or Python (FastAPI)
- Database: SQLite or PostgreSQL
- Frontend: React + Tailwind CSS + recharts
- External: Razorpay Test Mode API, optional LLM API
- Deployment: local/dev server for demo

### 2.5 Design & Implementation Constraints
- All monetary actions must be logged with a reason/justification
- Recovery actions must be bounded (max retries, budget caps, quiet hours)
- No offense-capable or fraud-classification logic anywhere in the system (this constraint specifically protects the Track 3 framing in §1.2)
- Messaging must use pre-approved/reviewable templates
- All data must be synthetic/test-mode; no real customer data
- Multi-merchant data for §4.4 must be clearly labeled as simulated in the UI

### 2.6 Assumptions & Dependencies
- Razorpay test-mode sandbox provides webhook events and test payment/subscription objects
- A synthetic dataset of 50–100 failed-payment records (single merchant) plus a smaller simulated multi-merchant dataset (5–10 merchants) will be generated
- LLM API availability for message/insight generation (optional; degrades gracefully)

---

## 3. Functional Requirements — Core System (Must-Have)

### FR-1: Failure Ingestion
- FR-1.1: Listen for Razorpay webhook events `payment.failed` and `subscription.charged.failed`.
- FR-1.2: Support bulk import of a synthetic batch (CSV/JSON) simulating 50–100 failed payments.
- FR-1.3: Each failure persisted with: payment ID, customer name (synthetic), amount, failure reason code, payment type, timestamp, merchant ID (for §4.4).

### FR-2: Root-Cause Classification
- FR-2.1: Classify each failure into TRANSIENT, CARD_ISSUE, or MANDATE_ISSUE via a deterministic rules table.
- FR-2.2: Store the classification and the rule that produced it for auditability.

### FR-3: Expected-Value Triage Queue
- FR-3.1: Compute a `priority_score` per failure = estimated recovery probability × amount at risk − action cost/fatigue penalty.
- FR-3.2: Maintain a configurable recovery action budget per time window.
- FR-3.3: Process failures in descending priority-score order until budget exhausted; defer remainder.
- FR-3.4: Support a "naive mode" (FIFO, no prioritization, no budget) for comparison.

### FR-4: Recovery Tactic Selection (Bandit)
- FR-4.1: For CARD_ISSUE, choose among ≥2 candidate channels/tactics.
- FR-4.2: Use epsilon-greedy allocation based on observed recovery outcomes per segment.
- FR-4.3: Update tactic success rates as outcomes are recorded.

### FR-5: Bounded Recovery Execution
- FR-5.1: TRANSIENT — auto-retry with exponential backoff, capped at 3 attempts.
- FR-5.2: CARD_ISSUE — generate Payment Link + templated message, max 1 follow-up after 24h.
- FR-5.3: MANDATE_ISSUE — mandate retry sequence within Razorpay's allowed window, capped attempts.
- FR-5.4: No outbound message outside configurable quiet-hours window.
- FR-5.5: No further action once a payment is `recovered`, `refunded`, or `exhausted`.

### FR-6: Promise-to-Pay Tracking
- FR-6.1: Detect promise-to-pay intent from a simulated customer reply.
- FR-6.2: Schedule a single follow-up for the promised date; suppress nudges until then.

### FR-7: Audit Logging
- FR-7.1: Every classification, priority-score computation, tactic selection, action, and outcome logged with timestamp and justification.
- FR-7.2: Audit log queryable/filterable by payment ID.

### FR-8: Dashboard (Core)
- FR-8.1: Display total ₹ at risk, ₹ recovered, recovery rate, avg time-to-recovery.
- FR-8.2: Side-by-side naive-vs-optimized comparison chart (₹ recovered per actions sent), updating progressively during a batch run (not a static end-state jump).
- FR-8.3: Live/scrolling action feed during batch runs.
- FR-8.4: Filterable audit table.

### FR-9: Leak-to-Fix Insights
- FR-9.1: Aggregate resolved/unresolved failures to identify recurring patterns.
- FR-9.2: Generate natural-language summary + suggested preventive action per pattern.
- FR-9.3: Fall back to static rule-based summary if LLM unavailable.

---

## 4. Functional Requirements — Advanced Layer (Differentiators)

### FR-10: Salary-Date-Aware Retry
- FR-10.1: For CARD_ISSUE failures classified as `insufficient_funds`, the system shall check historical/simulated recovery-success-by-day-of-month data.
- FR-10.2: If a clear success pattern exists around salary dates (1st, and typically 28th–2nd), the system shall schedule the retry/message for that window instead of the default fixed backoff, within the overall MAX_RETRY_ATTEMPTS cap from FR-5.1.
- FR-10.3: This scheduling decision shall be logged with its justification (e.g., "scheduled for day 1: historical insufficient_funds recovery rate 3.2x higher near salary date").

### FR-11: Interactive Policy Sandbox
- FR-11.1: The dashboard shall expose at least two live-adjustable controls: recovery aggressiveness (gentle ↔ aggressive) and budget per window (e.g., 10–50 actions/hour).
- FR-11.2: On any control change, the dashboard shall recompute and display projected outcomes (₹ recoverable, messages sent, estimated fatigue score) without a full page reload, using the existing triage/priority logic against the current batch.
- FR-11.3: This is a projection/simulation feature for demo and decision-support purposes — it shall not itself trigger real recovery actions; a separate explicit "Run" action (FR-8.2/FR-9's batch runner) executes for real.

---

## 5. Functional Requirements — Network Intelligence Layer (Razorpay-Specific)

**Framing reminder (see §1.2): this layer exists to make recovery smarter, not to detect fraud.**

### FR-12: Multi-Merchant Simulated Dataset
- FR-12.1: The system shall generate a simulated dataset representing 5–10 distinct merchants, each with their own failed-payment stream, clearly labeled as simulated in the UI.
- FR-12.2: Each simulated merchant's records shall include a `merchant_id` and a `bank`/`gateway` field to enable cross-merchant aggregation.

### FR-13: Bank/Gateway Outage Detection (Circuit Breaker)
- FR-13.1: The system shall continuously (or per-batch-tick, for demo purposes) compute the rolling failure rate per bank/gateway across all simulated merchants.
- FR-13.2: If a bank/gateway's failure rate exceeds a configurable threshold (e.g., 3x its baseline) within a rolling window (e.g., 15 minutes simulated), the system shall flag it as a suspected outage.
- FR-13.3: On a flagged outage, the system shall pause TRANSIENT-classified retries and CARD_ISSUE payment-link sends for that specific bank/gateway only — other banks/gateways continue processing normally.
- FR-13.4: The system shall display a "Network Alert" panel stating: which bank/gateway, how many merchants affected, the failure-rate delta, and the pause status.
- FR-13.5: When the bank/gateway's failure rate returns below threshold, the system shall automatically resume retries for it and log the resumption.
- FR-13.6: Every pause/resume decision shall be logged with justification, distinct from individual payment-level audit entries (FR-7).
- FR-13.7: This detection logic shall only ever produce a pause/resume action on retry scheduling — it shall never classify, flag, or take any action framed as fraud/risk against a transaction or customer (enforces §1.2/§2.5 constraint).

### FR-14: Network Alert Explainability
- FR-14.1: Each Network Alert shall include a one-line explanation of why this insight required cross-merchant data (e.g., "Only visible because 3 unrelated merchants share this pattern — no single merchant's data would show this").

---

## 6. Non-Functional Requirements

### NFR-1: Explainability
Every automated action (including circuit-breaker pause/resume and salary-date scheduling) must be traceable to a stated reason in the audit trail.

### NFR-2: Bounded Autonomy
All recovery actions must respect hard caps (retry counts, budget limits, quiet hours). The Policy Sandbox (FR-11) must never bypass these caps — it can adjust budget *within* configured system limits, not remove them.

### NFR-3: Performance
Process a batch of 100 synthetic failures in under 60 seconds for demo purposes; policy sandbox recompute (FR-11.2) should respond in under 2 seconds.

### NFR-4: Reliability
Handle at least one simulated failure gracefully (webhook delivery failure or LLM API timeout) without crashing the batch run.

### NFR-5: Data Privacy
No real customer PII; all data synthetic. Multi-merchant simulated data explicitly labeled as such in the UI.

### NFR-6: Usability
Dashboard must present the key comparison metric within the first screen. Network Alerts must be visually distinct from routine audit entries (different color/section) so judges immediately register them as a separate capability.

### NFR-7: Maintainability
Classification rules, budget parameters, quiet-hours, and outage-detection thresholds shall be externalized to a config file, not hardcoded.

### NFR-8: Track Integrity
No feature, UI label, or demo narration shall describe any part of the system as fraud detection, risk scoring, or a defense/offense capability. All language must consistently frame the system as revenue recovery optimization (enforces §1.2).

---

## 7. External Interface Requirements

### 7.1 Razorpay Test-Mode APIs
Payments API, Subscriptions API, Payment Links API, Webhooks (`payment.failed`, `subscription.charged.failed`).

### 7.2 Messaging (Mocked)
SMS/WhatsApp sends simulated — written to audit log and live feed, not delivered to real numbers.

### 7.3 LLM API (Optional)
Used for: personalizing Hinglish message templates, generating Leak-to-Fix summaries, generating Network Alert explanations (FR-14.1). Must not be used to decide retry/escalate/stop/pause logic — that remains deterministic code per NFR-2.

---

## 8. Data Requirements

### 8.1 Core Entities
**Payment/Failure Record**: payment_id, merchant_id, customer_name, amount, currency, status, failure_reason, type, bank/gateway, created_at, classification, priority_score

**Action Log**: action_id, payment_id, action_type, channel, timestamp, justification, outcome, budget_window_id

**Recovery Outcome**: payment_id, recovered, recovered_amount, recovered_at, tactic_used, attempts_made

**Bandit State**: segment, success_count, attempt_count, current_allocation_weight

**Insight**: insight_id, pattern_description, affected_count, suggested_fix, generated_at

**Network Event** (new): event_id, bank_gateway, affected_merchant_ids, failure_rate_delta, status (flagged/resumed), timestamp, justification

### 8.2 Seed Data
- Single-merchant batch: 50–100 records (as before)
- Multi-merchant simulated batch: 5–10 merchants × ~15–20 records each, with an engineered outage scenario (one bank spikes at a specific simulated time) so the circuit breaker has something real to detect in the demo

---

## 9. System Architecture (High-Level)

```
Razorpay Test Mode ──(webhooks)──► Webhook Listener
                                         │
                                         ▼
                              Failure Classifier (rules)
                                         │
                    ┌────────────────────┼─────────────────────┐
                    ▼                                            ▼
     Expected-Value Triage Queue                    Network Intelligence Module
     (budget-capped, salary-date aware)              (cross-merchant failure-rate
                    │                                  monitor → circuit breaker)
        ┌───────────┼───────────┐                                │
        ▼           ▼           ▼                                ▼
   TRANSIENT   CARD_ISSUE   MANDATE_ISSUE            Pause/Resume signal
   (retry)    (bandit-       (retry                  applied to Triage Queue
               selected       sequence)               for affected bank/gateway
               channel)
                    │
                    ▼
          Promise-to-Pay Tracker
                    │
                    ▼
    Data Store (Payments, Actions, Outcomes,
      Bandit State, Insights, Network Events)
                    │
        ┌───────────┼──────────────────────┐
        ▼                                    ▼
 React Dashboard                    Leak-to-Fix Insight
 (metrics, comparison,               Generator (LLM)
  live feed, audit table,
  Network Alerts panel,
  Policy Sandbox sliders)
```

---

## 10. Use Cases (Summary)

| ID | Use Case | Primary Actor | Outcome |
|---|---|---|---|
| UC-1 | Ingest failed payment batch | System | Failures classified and queued |
| UC-2 | Run optimized recovery batch | Admin/System | Recovery actions executed within budget, results logged |
| UC-3 | Run naive recovery batch (comparison) | Admin/System | Baseline results for comparison chart |
| UC-4 | View dashboard | Merchant Ops Viewer | Sees ₹ recovered, recovery rate, comparison chart |
| UC-5 | Inspect audit trail for a payment | Merchant Ops Viewer | Sees full reasoning/action history |
| UC-6 | Simulate customer promise-to-pay | Admin (demo) | Follow-up scheduled, nudges suppressed |
| UC-7 | View Leak-to-Fix insights | Merchant Ops Viewer | Sees pattern + suggested preventive fix |
| UC-8 | Adjust policy sandbox sliders | Judge/Demo Operator | Sees projected outcome change live |
| UC-9 | Observe bank outage detection | Merchant Ops Viewer / Judge | Sees Network Alert, retries paused/resumed automatically |

---

## 11. Acceptance Criteria (Hackathon "Bar")

**Core (must pass all):**
- [ ] Batch of ≥50 synthetic failed payments processed end-to-end
- [ ] Naive vs. optimized comparison shows higher ₹ recovered per action in optimized mode
- [ ] At least one live end-to-end flow uses real Razorpay test-mode webhook/API
- [ ] All recovery actions respect stopping rules — demonstrable in audit log
- [ ] Dashboard shows: at-risk ₹, recovered ₹, recovery rate, comparison chart, live feed, audit table
- [ ] At least one Leak-to-Fix insight generated and displayed
- [ ] One failure case handled gracefully and shown in the demo

**Advanced (add if time allows, in this priority order):**
- [ ] Policy sandbox sliders visibly change projected outcomes live
- [ ] Salary-date retry scheduling logged with justification for at least one insufficient-funds case
- [ ] Network Intelligence: at least one engineered outage scenario is detected, a Network Alert is shown, retries pause and later resume, all logged

**Track integrity (non-negotiable):**
- [ ] No feature, label, or demo line frames any part of the system as fraud/risk detection

---

## 12. Requirement → Build Step Mapping

See `Cursor_Build_Guide.md` (Steps 1–17) and `Implementation_Roadmap.md` (Phases 0–7) for the full execution plan. Summary:

| Requirement Group | Build Steps | Phase |
|---|---|---|
| FR-1 to FR-9 (Core) | Steps 1–11 | Phase 1–4 |
| §5.1 Real webhook | Step 12 | Phase 5 |
| Polish | Step 13 | Phase 6 |
| FR-10 Salary-date retry | Step 14 | Phase 6.5 |
| FR-11 Policy Sandbox | Step 15 | Phase 6.5 |
| FR-12/13/14 Network Intelligence | Steps 16–17 | Phase 6.5 |
| Demo/writeup prep | — | Phase 7 |

If time is short, cut in reverse order of this table (Network Intelligence first, Core last) per the Roadmap's cut-order guidance.

---

## 13. Future Enhancements (Out of Current Scope)
- Real SMS/WhatsApp delivery integration
- Real multi-merchant production data (vs. simulated)
- Production-grade ML model replacing rule-based classifier
- Full production deployment with compliance review
