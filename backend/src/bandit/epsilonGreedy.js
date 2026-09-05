import config from '../config.js';
import { banditState } from '../db/queries.js';

/** Epsilon-greedy channel selection for CARD_ISSUE — SRS FR-4 */

function segmentKey(classification, channel) {
  return `${classification}:${channel}`;
}

function ensureInitialized(classification) {
  for (const channel of config.CARD_CHANNELS) {
    const key = segmentKey(classification, channel);
    if (!banditState.get(key)) {
      banditState.upsert(key, 0, 0, 0.5);
    }
  }
}

export function selectChannel(classification) {
  if (classification !== 'CARD_ISSUE') return null;
  ensureInitialized(classification);

  const explore = Math.random() < config.EPSILON;
  if (explore) {
    const channel =
      config.CARD_CHANNELS[Math.floor(Math.random() * config.CARD_CHANNELS.length)];
    return { channel, mode: 'explore' };
  }

  let best = config.CARD_CHANNELS[0];
  let bestWeight = -1;
  for (const channel of config.CARD_CHANNELS) {
    const row = banditState.get(segmentKey(classification, channel));
    const w = row?.current_allocation_weight ?? 0.5;
    if (w > bestWeight) {
      bestWeight = w;
      best = channel;
    }
  }
  return { channel: best, mode: 'exploit' };
}

export function recordOutcome(classification, channel, recovered) {
  if (!channel || classification !== 'CARD_ISSUE') return;
  const key = segmentKey(classification, channel);
  const row = banditState.get(key) || {
    success_count: 0,
    attempt_count: 0,
    current_allocation_weight: 0.5,
  };
  const success_count = row.success_count + (recovered ? 1 : 0);
  const attempt_count = row.attempt_count + 1;
  // Laplace smoothing: (success+1)/(attempt+2)
  const weight = (success_count + 1) / (attempt_count + 2);
  banditState.upsert(key, success_count, attempt_count, weight);
  return { segment: key, success_count, attempt_count, weight };
}

export default { selectChannel, recordOutcome };
