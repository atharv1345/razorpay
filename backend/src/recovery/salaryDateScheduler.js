import config from '../config.js';

/** Salary-date-aware scheduling for insufficient_funds — SRS FR-10 */

const LOOKUP = {
  // Demo static table: relative success rates by day-of-month
  default: 1.0,
  salary: config.SALARY_SUCCESS_MULTIPLIER,
};

export function isSalaryWindow(date = new Date()) {
  const day = date.getDate();
  return config.SALARY_DAYS.includes(day);
}

export function nextSalaryWindowDate(from = new Date()) {
  if (isSalaryWindow(from)) return new Date(from);
  for (let i = 1; i <= 40; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    if (isSalaryWindow(d)) {
      d.setHours(10, 0, 0, 0);
      return d;
    }
  }
  const next = new Date(from);
  next.setMonth(next.getMonth() + 1, 1);
  next.setHours(10, 0, 0, 0);
  return next;
}

/**
 * For insufficient_funds CARD_ISSUE: schedule near salary window if not already in one.
 * Returns { shouldDefer, scheduledAt, justification } or null if N/A.
 */
export function planSalaryAwareSchedule(payment, now = new Date()) {
  if (
    payment.classification !== 'CARD_ISSUE' ||
    payment.failure_reason !== 'insufficient_funds'
  ) {
    return null;
  }

  if (isSalaryWindow(now)) {
    return {
      shouldDefer: false,
      scheduledAt: now,
      justification: `within salary window (day ${now.getDate()}): insufficient_funds recovery rate ${LOOKUP.salary}x higher near salary date`,
      salaryAware: true,
    };
  }

  const scheduledAt = nextSalaryWindowDate(now);
  scheduledAt.setHours(10, 0, 0, 0);
  return {
    shouldDefer: true,
    scheduledAt,
    justification: `scheduled for day ${scheduledAt.getDate()}: insufficient_funds recovery rate ${LOOKUP.salary}x higher near salary date`,
    salaryAware: true,
  };
}

export default { planSalaryAwareSchedule, isSalaryWindow, nextSalaryWindowDate };
