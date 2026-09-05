# Recovery Yield Optimizer

**Track:** AI Revenue Recovery (Track 3) — primary and only track.

An AI agent that detects at-risk revenue, prioritizes recovery under a fixed action budget, executes bounded workflows, learns which tactics work per segment, detects bank/gateway-wide outages across merchants so recovery doesn’t burn budget on doomed retries, and surfaces preventive Leak-to-Fix insights.

> We detect network-wide patterns so our recovery is smarter — **not** to catch fraud.

---

## Stack

- **Backend:** Node.js, Express, better-sqlite3  
- **Frontend:** Vite, React, Tailwind, recharts  
- **External:** Razorpay test-mode (webhooks / Payment Links), optional Anthropic LLM  

---

## How to run

```bash
# 1. Install
npm install
npm run install:all

# 2. Env
copy backend\.env.example backend\.env

# 3. Master demo seed (preferred before pitches)
npm run demo:reset

# 4. Start API (:8303) + dashboard (:9598)
npm run dev:backend
npm run dev:frontend
```

Open http://localhost:9598 — follow `scripts/DEMO_SCRIPT.md` for the live pitch order.

Or use **Reset Demo Data** in the dashboard header between practice runs.

### Run in Razorpay simulation mode

This is the default and requires no Razorpay credentials:

```env
RAZORPAY_SANDBOX_MODE=simulate
```

In this mode the dashboard labels Payment Links as **Sandbox Simulation**, and recovery outcomes are simulated for repeatable demos.

### Run with Razorpay Test Mode Payment Links

Set these values in `backend/.env` using Razorpay Test Mode credentials:

```env
RAZORPAY_SANDBOX_MODE=test
RAZORPAY_KEY_ID=rzp_test_your_key
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

In Test Mode, the backend creates Payment Links through the Razorpay API. Configure this webhook URL in Razorpay Dashboard → Test Mode → Webhooks:

```text
https://<public-host>/api/webhooks/razorpay
```

Subscribe to `payment.failed`, `subscription.charged.failed`, and `payment_link.paid`. The `payment_link.paid` event marks the linked payment as recovered and updates dashboard metrics.

### Port already in use

If the backend shows `EADDRINUSE` for port `8303`, another backend process is already running. Check and stop it before starting a new watcher:

```powershell
Get-NetTCPConnection -LocalPort 8303
Stop-Process -Id <PID> -Force
npm run dev
```

An existing healthy backend can be verified at http://localhost:8303/api/health. Do not start two backend processes on the same port.

### Razorpay webhook (credibility flow)

1. Expose localhost: `ngrok http 8303`
2. Set `RAZORPAY_SANDBOX_MODE=test` plus Razorpay Test Mode credentials in `backend/.env`.
3. In Razorpay Dashboard → Test Mode → Webhooks, register `https://<ngrok>/api/webhooks/razorpay`
4. Subscribe to `payment.failed`, `subscription.charged.failed`, and `payment_link.paid`
5. Set `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`

With `RAZORPAY_SANDBOX_MODE=simulate`, recovery outcomes and payment links are simulated so the demo works without Razorpay credentials. With `test`, Payment Links are created through Razorpay Test Mode and `payment_link.paid` updates the recovery metrics.

---

## Demo script (~4 min)

1. **(20s)** Metrics bar — “Here’s a batch of failed payments worth ₹X at risk.”
2. **(40s)** Click **Run naive vs optimized** — “Same budget: FIFO vs expected-value triage.”
3. **(40s)** Audit table — max retries, quiet hours, terminal-state skips, salary-date badge.
4. **(30s)** Policy Sandbox — move sliders; show live projection (not executed), then **Run with these settings**.
5. **(40s)** Network Alerts — **Scan for outages** → HDFC pause across merchants → resume.  
   *“A single merchant would just see failures. Platform view shows it’s an HDFC outage — we pause pointless retries and resume when it clears.”*
6. **(30s)** Leak-to-Fix insights — preventive fix, not just patching.
7. **(20s)** Close with recovery rate + ₹ recovered. Remind: Track 3 recovery only.

---

## What this solves (Track 3)

Failed payments are revenue sitting on the table. Naive FIFO recovery wastes budget on low-EV cases and retries into gateway outages. This system:

| Capability | Why judges care |
|---|---|
| EV triage queue + budget | Higher ₹ recovered per action vs naive |
| Epsilon-greedy bandit | Learns SMS / WhatsApp / Hinglish channels |
| Hard stopping rules | Quiet hours, max retries, no double-recovery |
| Salary-date scheduling | insufficient_funds timed to payday windows |
| Policy sandbox | Live judge-tunable aggressiveness/budget |
| Network intelligence | Cross-merchant outage → pause/resume recovery |
| Leak-to-Fix | Preventive insight, not only reactive recovery |
| Full audit log | Every action has a justification |

---

## API (high level)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health + track framing |
| GET | `/api/metrics` | Dashboard KPIs |
| POST | `/api/batch/compare` | Start naive→optimized (poll progress) |
| GET | `/api/batch/progress` | Progressive compare state |
| POST | `/api/batch/run?mode=optimized` | Run recovery batch |
| GET | `/api/sandbox/project` | Read-only projection |
| GET | `/api/network/events` | Outage pause/resume events |
| POST | `/api/webhooks/razorpay` | Ingest test-mode failures |
| GET | `/api/insights` | Leak-to-Fix cards |

---

## Project layout

```
backend/src/{db,classifier,engine,bandit,recovery,insights,network,webhooks,routes}
frontend/src/{components,pages}
scripts/seed-data.js
scripts/seed-network-data.js
SRS_Recovery_Yield_Optimizer.md
Cursor_Build_Guide.md
Implementation_Roadmap.md
```
