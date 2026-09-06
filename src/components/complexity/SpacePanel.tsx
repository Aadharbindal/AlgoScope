'use client';

import { useMemo } from 'react';
import { AlgorithmDef, countSpace } from '@/lib/algorithms/types';
import { analyseGrowth } from '@/lib/trace/complexity';

/**
 * Space, measured the same way time is.
 *
 * Until now this panel printed a hardcoded string beside a measured one, at the
 * same size and in the same typeface — which quietly said the two were facts of
 * the same kind. They were not. Space is now re-measured at increasing input
 * sizes by sampling the peak of everything the algorithm declared as working
 * storage, plus the deepest the call stack ever got.
 *
 * Where the fit is weak, that is reported rather than smoothed over. Recursion
 * depth on a shuffled input genuinely is noisy — quick sort's stack is about
 * 2 log n with real variance — and a confident notation over a poor fit would
 * be exactly the kind of claim this page exists to refuse.
 */

/** Below this, the measurement does not separate one family from another. */
const CONFIDENT = 0.9;

export function SpacePanel({ def }: { def: AlgorithmDef }) {
  const report = useMemo(() => {
    const points = def.growthSizes.map((n) => ({ n, ops: countSpace(def, def.makeInput(n)) }));
    return analyseGrowth(points, def.projectTo);
  }, [def]);

  const confident = report.best.r2 >= CONFIDENT;
  const peak = report.points[report.points.length - 1];

  return (
    <div className="rounded-xl border border-hairline bg-panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="label">Space</p>
        <span className="font-mono text-[0.6rem] text-faint">
          {confident ? 'measured' : 'measured, inconclusive'}
        </span>
      </div>

      <p className="mt-1.5 font-mono text-[0.95rem] text-ink">
        {confident ? report.best.model.notation : def.complexity.space}
      </p>

      {confident ? (
        <p className="mt-1.5 font-mono text-[0.68rem] text-faint">
          R² {report.best.r2.toFixed(3)} · {peak.ops.toLocaleString()} cells held at n ={' '}
          {peak.n.toLocaleString()}
        </p>
      ) : (
        <p className="mt-1.5 text-[0.74rem] leading-snug text-probe">
          The best fit here is {report.best.model.notation} at R² {report.best.r2.toFixed(3)}, which
          is not enough to tell one family from another — so the bound above is the claim, not a
          measurement. Recursion depth on shuffled input varies from run to run, and no amount of
          fitting turns that into a clean curve.
        </p>
      )}

      <p className="mt-2.5 text-[0.76rem] leading-snug text-muted">
        Counted as the most working storage held at once, plus the deepest the call stack reached.
        The input and the returned answer are excluded, which is what &ldquo;auxiliary&rdquo; means
        — a sort that rearranges the array it was handed allocates nothing.
      </p>

      {def.complexity.space !== report.best.model.notation && confident && (
        <p className="mt-2 border-t border-hairline pt-2 font-mono text-[0.68rem] leading-relaxed text-faint">
          stated bound: {def.complexity.space}
        </p>
      )}
    </div>
  );
}
