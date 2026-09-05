import { useState } from 'react';
import { api } from '../api';

const SALARY_BADGE_TYPES = new Set(['salary_date_scheduled']);

function isRepeatCustomer(justification = '') {
  return /relationship bonus|repeat customer|warm tone for \d+-month/i.test(
    justification
  );
}

export function AuditTable({ actions }) {
  const [paymentId, setPaymentId] = useState('');
  const [actionType, setActionType] = useState('');
  const [outcome, setOutcome] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [history, setHistory] = useState([]);

  const filtered = (actions || []).filter((a) => {
    if (paymentId && !a.payment_id?.includes(paymentId)) return false;
    if (actionType && a.action_type !== actionType) return false;
    if (outcome && a.outcome !== outcome) return false;
    return true;
  });

  async function expand(id) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    try {
      const data = await api.paymentHistory(id);
      setHistory(data.history || []);
    } catch {
      setHistory([]);
    }
  }

  return (
    <div className="panel p-4">
      <h3 className="font-display text-lg font-semibold">Audit trail</h3>
      <p className="mb-3 text-sm text-slate-400">Every decision with justification</p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="rounded-lg border border-slate-700 bg-ink-800 px-3 py-1.5 text-sm"
          placeholder="payment_id"
          value={paymentId}
          onChange={(e) => setPaymentId(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-700 bg-ink-800 px-3 py-1.5 text-sm"
          placeholder="action_type"
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-700 bg-ink-800 px-3 py-1.5 text-sm"
          placeholder="outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        />
      </div>

      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-ink-900 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Payment</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Outcome</th>
              <th className="px-2 py-2">Justification</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 80).map((a) => (
              <tr
                key={a.action_id}
                className="cursor-pointer border-t border-slate-800/80 hover:bg-ink-800/50"
                onClick={() => a.payment_id && expand(a.payment_id)}
              >
                <td className="px-2 py-2 font-mono text-xs text-slate-400">
                  {a.payment_id || '—'}
                </td>
                <td className="px-2 py-2">
                  <span className="font-mono text-xs text-mint-400">{a.action_type}</span>
                  {SALARY_BADGE_TYPES.has(a.action_type) && (
                    <span className="ml-2 rounded bg-amber-glow/20 px-1.5 py-0.5 text-[10px] text-amber-glow">
                      salary-date
                    </span>
                  )}
                  {isRepeatCustomer(a.justification) && (
                    <span className="ml-2 rounded bg-mint-500/15 px-1.5 py-0.5 text-[10px] text-mint-400">
                      Repeat customer
                    </span>
                  )}
                  {a.outcome === 'paused_network_outage' && (
                    <span className="ml-2 rounded bg-coral-alert/20 px-1.5 py-0.5 text-[10px] text-coral-alert">
                      network pause
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{a.outcome}</td>
                <td className="max-w-md truncate px-2 py-2 text-xs text-slate-400">
                  {a.justification}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg border border-mint-500/20 bg-ink-800/80 p-3">
          <div className="mb-2 font-mono text-xs text-mint-400">History · {expanded}</div>
          <ul className="space-y-1 text-xs text-slate-300">
            {history.map((h) => (
              <li key={h.action_id}>
                <span className="text-slate-500">{h.action_type}</span> → {h.justification}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default AuditTable;
