import { useState } from 'react';
import { api } from '../api';

const SUGGESTIONS = [
  'Why did pay_demo_014 get prioritized?',
  'What happened with the HDFC outage?',
  'Show Leak-to-Fix insights',
];

/** Read-only audit Q&A — never triggers recovery actions */
export function ExplainChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  async function ask(q) {
    const text = (q || question).trim();
    if (!text) return;
    setLoading(true);
    setQuestion('');
    try {
      const res = await api.explain(text);
      setHistory((h) => [...h, { q: text, a: res.answer, source: res.source }]);
    } catch (e) {
      setHistory((h) => [...h, { q: text, a: e.message, source: 'error' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(100vw-2rem,22rem)]">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="ml-auto block rounded-full bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-lg"
        >
          Explain It To Me
        </button>
      ) : (
        <div className="panel flex max-h-[70vh] flex-col overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div>
              <div className="font-display text-sm font-semibold">Explain It To Me</div>
              <div className="text-[10px] text-slate-500">Read-only · grounded in audit logs</div>
            </div>
            <button className="text-slate-400" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {history.map((item, i) => (
              <div key={i} className="space-y-1">
                <p className="text-mint-400">You: {item.q}</p>
                <p className="whitespace-pre-wrap text-xs text-slate-300">{item.a}</p>
              </div>
            ))}
            {!history.length && (
              <p className="text-xs text-slate-500">Ask about a payment_id, outage, or insight.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1 border-t border-slate-800 px-2 py-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="rounded bg-ink-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-ink-800"
                onClick={() => ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1 border-t border-slate-800 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              className="flex-1 rounded-lg border border-slate-700 bg-ink-800 px-2 py-1.5 text-sm"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about the audit trail…"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-mint-500/90 px-3 text-sm font-medium text-ink-950 disabled:opacity-50"
            >
              {loading ? '…' : 'Ask'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default ExplainChat;
