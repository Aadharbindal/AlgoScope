'use client';

import { useState } from 'react';
import { CeOutcome } from '@/store/player';
import { Divergence } from '@/lib/trace/diff';

/**
 * Divergence Point.
 *
 * The location is computed by diffing two execution traces — it is not an
 * opinion and no model was asked. Only the closing paragraph is authored
 * prose, and it stays hidden until the student has seen the evidence.
 */
export function DivergencePanel({
  explanation,
  divergence,
  totalSteps,
  onJump,
  ce,
}: {
  /** Authored prose, when this exact combination is one we wrote about. */
  explanation?: string;
  divergence: Divergence | null;
  totalSteps: number;
  onJump: (step: number) => void;
  ce: CeOutcome | null;
}) {
  const [revealed, setRevealed] = useState(false);

  if (!divergence) {
    return (
      <div className="rounded-[7px] border border-hairline bg-panel p-4">
        <p className="font-mono text-xs text-accent">
          No divergence on this input.
        </p>
        <p className="mt-2 text-[0.85rem] leading-snug text-ink-2">
          On this particular input the buggy version behaves exactly like the correct one, step for
          step. That is not proof it is correct — it is proof this input does not exercise the bug.
          Try one of the edge cases, or let the counterexample search pick an input for you.
        </p>
      </div>
    );
  }

  const pct = totalSteps > 1 ? Math.round((divergence.agreedFor / totalSteps) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[7px] border border-danger-edge bg-danger-dim p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-danger">
            divergence point
          </span>
          <span className="ml-auto font-mono text-[0.68rem] text-muted">
            agreed for {divergence.agreedFor} of {totalSteps} steps · {pct}%
          </span>
        </div>

        <p className="mt-2.5 text-[0.92rem] leading-snug text-ink">{divergence.summary}</p>

        {ce && (
          <div className="mt-3">
            {/* The distinction the search now makes, and the reason it makes
                it: a bug that returns the wrong answer and a bug that returns
                the right answer by a different route are not the same kind of
                thing. Reporting both as "found it" would teach that every bug
                announces itself. */}
            {ce.answerDiffers ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] border border-danger-edge bg-danger-dim/60 px-2.5 py-1.5 font-mono text-[0.7rem]">
                <span className="text-danger">this version returns {ce.yours}</span>
                <span className="text-faint">·</span>
                <span className="text-accent">the correct one returns {ce.correct}</span>
              </div>
            ) : (
              <div className="rounded-[6px] border border-probe-edge bg-probe-dim/40 px-2.5 py-2">
                <p className="font-mono text-[0.7rem] text-probe">
                  same answer here — only the work differs
                </p>
                <p className="mt-1 text-[0.78rem] leading-snug text-ink-2">
                  Both versions return{' '}
                  <span className="font-mono text-accent">{ce.correct}</span>. No input that was
                  tried makes this one give a wrong result, so what changed is the path taken, not
                  the answer produced. That is still worth seeing: a read past the end of an array
                  is undefined behaviour whether or not it happens to work today.
                </p>
              </div>
            )}
            <p className="mt-2 font-mono text-[0.66rem] text-muted">
              input found automatically by searching · {ce.label}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => onJump(divergence.index)}
          className="mt-3 rounded-[7px] border border-danger-edge bg-panel px-3 py-1.5 font-mono text-xs text-danger transition-colors hover:bg-danger hover:text-ground"
        >
          jump to step {divergence.index} →
        </button>
      </div>

      {(divergence.vars.length > 0 || divergence.cells.length > 0) && (
        <div className="overflow-x-auto rounded-[7px] border border-hairline">
          <table className="w-full min-w-[360px] font-mono text-xs">
            <thead>
              <tr className="border-b border-hairline bg-sunk text-faint">
                <th className="px-3 py-2 text-left font-medium">what</th>
                <th className="px-3 py-2 text-right font-medium">correct run</th>
                <th className="px-3 py-2 text-right font-medium">this version</th>
              </tr>
            </thead>
            <tbody>
              {divergence.vars.map((v) => (
                <tr key={v.key} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-1.5 text-muted">{v.key}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-accent">
                    {v.reference === undefined ? '—' : String(v.reference)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-danger">
                    {v.suspect === undefined ? '—' : String(v.suspect)}
                  </td>
                </tr>
              ))}
              {divergence.cells.slice(0, 8).map((c) => (
                <tr key={`${c.structId}-${c.index}`} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-1.5 text-muted">
                    {c.structId}[{c.index}]
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-accent">{c.reference}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-danger">{c.suspect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {explanation ? (
        <div className="rounded-[7px] border border-hairline bg-panel p-4">
          <p className="label mb-2">Why this happens</p>
          {revealed ? (
            <p className="rise text-[0.88rem] leading-relaxed text-ink-2">{explanation}</p>
          ) : (
            <div>
              <p className="text-[0.85rem] leading-snug text-muted">
                You can see exactly where and exactly what changed. Work out why before reading the
                answer — that is the part that transfers to your own bugs.
              </p>
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-3 rounded-[7px] border border-hairline-strong bg-sunk px-3 py-1.5 font-mono text-xs text-ink-2 transition-colors hover:border-accent-edge hover:text-accent"
              >
                reveal the explanation
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-[7px] border border-dashed border-hairline-strong px-3 py-2.5 text-[0.82rem] leading-snug text-muted">
          This combination of edits is your own, so there is no written explanation for it — only
          the evidence above, which is the part that was ever trustworthy anyway.
        </p>
      )}
    </div>
  );
}
