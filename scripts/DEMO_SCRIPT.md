# Demo Script — Recovery Yield Optimizer

Timed checklist for the live hackathon demo (~4 min). Run this **twice** in practice.

## Before you start

```bash
npm run demo:reset
# or: node scripts/seed-demo-scenario.js --reset
npm run dev:backend
npm run dev:frontend
```

Open http://localhost:9598

---

## Live click order

1. **Reset** (if needed) — click **Reset Demo Data** in the header (or re-run `npm run demo:reset`).
2. **Metrics bar** — point at At Risk ₹, Recovered ₹, Recovery Rate (by ₹, with by-count subtext).
3. **Run naive vs optimized** — wait for chart to finish. Confirm **4 bars**: Recovered + Actions for Naive and Optimized. Call out higher yield/action on Optimized.
4. **Audit table** — filter or scroll to show:
   - one `retry_transient` / recovered or exhausted path
   - one `salary_date_scheduled` badge
   - one **Repeat customer** badge (relationship bonus)
   - `pay_demo_040` PTP suppressed nudges
5. **Scan for outages** — HDFC **paused** card appears (simulated multi-merchant). Optionally **resume**.
6. **Leak-to-Fix** — one clear `network_error` @ 19:00 pattern card (no duplicates).
7. **At-Risk Radar** — 2 HIGH + 1 MEDIUM; say “Predicted — no failure has happened yet.”
8. **Explain It To Me** — click suggested question e.g. *Why did pay_demo_014 get prioritized?* — grounded answer from logs.
9. **Close** — recovery rate + ₹ recovered + “platform-scale network pause, not fraud detection.”

---

## Cut if running long

Drop Policy Sandbox first; keep Network Alerts + comparison chart + audit badges.
