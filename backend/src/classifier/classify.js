/**
 * Failure classification — SRS FR-2
 * Deterministic rules only; no ML / no fraud framing.
 */

const TRANSIENT_REASONS = new Set(['network_error', 'gateway_timeout']);
const CARD_REASONS = new Set(['card_expired', 'insufficient_funds']);
const MANDATE_REASONS = new Set(['mandate_not_approved', 'auth_failed']);

export function classifyFailure(failure_reason, type) {
  if (TRANSIENT_REASONS.has(failure_reason)) {
    return {
      classification: 'TRANSIENT',
      rule: `failure_reason='${failure_reason}' → TRANSIENT (temporary network/gateway glitch)`,
    };
  }

  if (CARD_REASONS.has(failure_reason)) {
    return {
      classification: 'CARD_ISSUE',
      rule: `failure_reason='${failure_reason}' → CARD_ISSUE (card/funds issue)`,
    };
  }

  if (MANDATE_REASONS.has(failure_reason) && type === 'subscription') {
    return {
      classification: 'MANDATE_ISSUE',
      rule: `failure_reason='${failure_reason}' + type=subscription → MANDATE_ISSUE`,
    };
  }

  return {
    classification: 'CARD_ISSUE',
    rule: `unrecognized failure_reason='${failure_reason}' → CARD_ISSUE (defaulted)`,
  };
}

export default classifyFailure;
