'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrayView, RegionLegend } from '@/components/viz/ArrayView';
import { binarySearch } from '@/lib/algorithms/binary-search';
import { buildTrace } from '@/lib/algorithms/types';
import { resolveLens } from '@/lib/trace/lens';

/**
 * The landing page opens on a real execution, already part-way through, with
 * half the array visibly ruled out. Someone who reads nothing else should
 * still understand what this tool does from the first frame.
 */
export function LiveDemo() {
  const trace = useMemo(() => buildTrace(binarySearch, binarySearch.defaultInput), []);

  // Open at the first elimination — the moment that carries the whole idea.
  const opening = useMemo(() => {
    const i = trace.steps.findIndex((s) => s.line === 12 || s.line === 14);
    return i > 0 ? i : Math.floor(trace.steps.length / 2);
  }, [trace]);

  const [step, setStep] = useState(opening);
  const current = trace.steps[Math.min(step, trace.steps.length - 1)];
  const previous = step > 0 ? trace.steps[step - 1] : undefined;
  const view = useMemo(
    () => resolveLens(binarySearch.lens, current, trace.oracle),
    [current, trace.oracle],
  );

  const atEnd = step >= trace.steps.length - 1;

  return (
    <div className="overflow-hidden rounded-[4px] border border-hairline bg-panel shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
        <span className="font-mono text-[0.65rem] text-muted">
          binary search · arr = [2, 5, 8, 12, 16, 23, 38, 45, 56] · target = 38
        </span>
        <span className="font-mono text-[0.65rem] tabular-nums text-faint">
          step {step} / {trace.steps.length - 1}
        </span>
      </div>

      <div className="px-4 py-8 sm:px-10">
        <div className="flex flex-col gap-3">
          <ArrayView
            struct={current.structs.arr as never}
            previous={previous?.structs.arr as never}
            pointers={view.pointers}
            regions={view.regions}
            event={current.event}
            step={current.i}
          />
          <RegionLegend regions={view.regions} />
        </div>
      </div>

      <div className="flex min-h-[4rem] items-start gap-3 border-y border-hairline bg-sunk px-4 py-3 sm:px-6">
        <p key={current.i} className="rise text-[0.9rem] leading-snug text-ink">
          {current.narration}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-[3px] border border-hairline bg-panel px-3 py-1.5 font-mono text-xs text-ink-2 transition-colors hover:border-hairline-strong disabled:opacity-35"
        >
          ← back
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => (atEnd ? opening : s + 1))}
          className="rounded-[3px] border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent"
        >
          {atEnd ? '↻ replay' : 'step →'}
        </button>

        {view.invariant && (
          <span
            className={[
              'ml-auto rounded-[3px] border px-2 py-1 font-mono text-[0.62rem]',
              view.invariant.holds
                ? 'border-accent-edge bg-accent-dim text-accent'
                : 'border-danger-edge bg-danger-dim text-danger',
            ].join(' ')}
          >
            invariant {view.invariant.holds ? 'holds' : 'broken'}
          </span>
        )}

        <Link
          href="/a/binary-search"
          className="rounded-[3px] border border-hairline bg-panel px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-accent-edge hover:text-accent"
        >
          open the full instrument →
        </Link>
      </div>
    </div>
  );
}
