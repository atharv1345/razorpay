const BASE = '/api';

async function req(path, opts) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => req('/health'),
  metrics: () => req('/metrics'),
  config: () => req('/config'),
  startCompare: (body) =>
    req('/batch/compare', { method: 'POST', body: JSON.stringify(body || {}) }),
  progress: () => req('/batch/progress'),
  runBatch: (mode, body) =>
    req(`/batch/run?mode=${mode}`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  recentActions: () => req('/actions/recent?limit=30'),
  actions: (q) => {
    const qs = new URLSearchParams(q).toString();
    return req(`/actions?${qs}`);
  },
  paymentHistory: (id) => req(`/payments/${id}`),
  insights: () => req('/insights'),
  sandbox: (aggressiveness, budget) =>
    req(`/sandbox/project?aggressiveness=${aggressiveness}&budget=${budget}`),
  networkEvents: () => req('/network/events'),
  detectNetwork: () => req('/network/detect', { method: 'POST' }),
  resumeBank: (bank) => req(`/network/resume/${bank}`, { method: 'POST' }),
  predictions: () => req('/predictions/at-risk'),
  explain: (question) =>
    req('/explain', { method: 'POST', body: JSON.stringify({ question }) }),
  resetDemo: () => req('/dev/reset-demo', { method: 'POST', body: '{}' }),
};

export default api;
