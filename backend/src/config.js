/** Single source of truth for caps/budgets/thresholds — SRS NFR-7 */
export const config = {
  BUDGET_PER_WINDOW: 20,
  QUIET_HOURS_START: 9,
  QUIET_HOURS_END: 21,
  MAX_RETRY_ATTEMPTS: 3,
  OUTAGE_THRESHOLD_MULTIPLIER: 3,
  OUTAGE_WINDOW_MINUTES: 15,
  EPSILON: 0.1,
  FATIGUE_PENALTY: 5,
  /** Show Reset Demo Data button when true */
  DEMO_RESET_ENABLED: process.env.DEMO_RESET_ENABLED !== '0',
  /** Hours before the same subscription can receive another preemptive_nudge at the same risk level */
  PREEMPTIVE_NUDGE_COOLDOWN_HOURS: Number(process.env.PREEMPTIVE_NUDGE_COOLDOWN_HOURS) || 24,
  RECOVERY_PRIORS: {
    TRANSIENT: 0.7,
    CARD_ISSUE: 0.4,
    MANDATE_ISSUE: 0.3,
  },
  CARD_CHANNELS: ['sms_link', 'whatsapp_link', 'hinglish_nudge'],
  /** Days of month with ~3x higher insufficient_funds recovery (salary window) */
  SALARY_DAYS: [1, 2, 3, 28, 29, 30, 31],
  SALARY_SUCCESS_MULTIPLIER: 3.2,
  PORT: Number(process.env.PORT) || 8303,
  RAZORPAY_SANDBOX_MODE: process.env.RAZORPAY_SANDBOX_MODE || 'simulate',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
};

export default config;
