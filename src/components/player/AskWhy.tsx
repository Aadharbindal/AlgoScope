'use client';

import { useState } from 'react';
import { buildPayload } from '@/lib/ai/payload';
import { ResolvedView } from '@/lib/trace/lens';
import { Step, Trace } from '@/lib/trace/types';

const SUGGESTIONS = [
  'Why did that variable change?',
  'What would break if this line were removed?',
  'Why is this step necessary?',
];

interface Answer {
  answer: string;
  unverified: string[];
  grounded: boolean;
}

export function AskWhy({
  trace,
  step,
  previous,
  view,
  code,
}: {
  trace: Trace;
  step: Step;
  previous?: Step;
  view: ResolvedView;
  code: string;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    setError(null);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(q, trace, step, previous, view, code)),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Something went wrong.');
      else setAnswer(data as Answer);
    } catch {
      setError('Could not reach the tutor service.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask(question);
          }}
          placeholder="Ask about this exact step…"
          className="min-w-0 flex-1 rounded-[3px] border border-hairline bg-sunk px-2.5 py-2 font-mono text-xs text-ink outline-none transition-colors focus:border-accent-edge"
        />
        <button
          type="button"
          onClick={() => ask(question)}
          disabled={busy || !question.trim()}
          className="rounded-[3px] border border-accent-edge bg-accent-dim px-3 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent disabled:opacity-35 disabled:hover:bg-accent-dim disabled:hover:text-accent"
        >
          {busy ? '…' : 'ask'}
        </button>
      </div>

      {!answer && !error && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              className="rounded-[3px] border border-hairline bg-panel px-2 py-1 text-left font-mono text-[0.62rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-[3px] border border-hairline bg-sunk px-2.5 py-2 text-[0.78rem] leading-snug text-muted">
          {error}
        </p>
      )}

      {answer && (
        <div className="rise rounded-[3px] border border-hairline bg-sunk p-3">
          <p className="text-[0.85rem] leading-relaxed text-ink-2">{answer.answer}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
            <span
              className={[
                'rounded-[2px] px-1.5 py-0.5 font-mono text-[0.58rem]',
                answer.grounded
                  ? 'bg-accent-dim text-accent'
                  : 'bg-danger-dim text-danger',
              ].join(' ')}
            >
              {answer.grounded
                ? 'every figure checked against the trace'
                : `unverified: ${answer.unverified.join(', ')}`}
            </span>
            <span className="font-mono text-[0.58rem] text-faint">
              written by a model from this step&rsquo;s state · the picture above is not
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
