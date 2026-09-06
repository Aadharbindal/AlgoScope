'use client';

import { useMemo } from 'react';
import { AlgorithmDef, countOps } from '@/lib/algorithms/types';
import { analyseGrowth, MODELS } from '@/lib/trace/complexity';

/**
 * Measured growth, not asserted growth.
 *
 * The algorithm is re-run at increasing input sizes with counters on, and the
 * operation counts are fitted in log space. Plotted log-log, where a power law
 * is a straight line and the slope is the exponent.
 */
/** 64, 1k, 16k, 1M — not "1.024k". */
const compactN = (n: number) => {
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
};

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** Log axes get exponent labels; spelled-out magnitudes overflow the margin. */
const powerLabel = (v: number) => {
  const e = Math.round(Math.log10(v));
  if (e < 3) return String(v);
  return `10${String(e)
    .split('')
    .map((d) => SUPS[Number(d)])
    .join('')}`;
};

export function GrowthChart({ def }: { def: AlgorithmDef }) {
  const report = useMemo(() => {
    const points = def.growthSizes.map((n) => ({ n, ops: countOps(def, def.makeInput(n)) }));
    return analyseGrowth(points, def.projectTo);
  }, [def]);

  const W = 720;
  const H = 380;
  const M = { top: 24, right: 96, bottom: 46, left: 58 };

  const xs = [...report.points.map((p) => p.n), report.projection.n];
  // The judge budget only shares the axis when it is near the data. For an
  // efficient algorithm it sits six decades above, and including it would
  // squash the entire measurement into the bottom pixel row.
  const dataMax = Math.max(...report.points.map((p) => p.ops), report.projection.ops);
  const budgetOnScale = report.projection.budget <= dataMax * 100;
  const ys = budgetOnScale
    ? [...report.points.map((p) => p.ops), report.projection.ops, report.projection.budget]
    : [...report.points.map((p) => p.ops), report.projection.ops];

  const xMin = Math.log10(Math.max(2, Math.min(...xs)));
  const xMax = Math.log10(Math.max(...xs));
  const yMin = Math.log10(Math.max(1, Math.min(...ys.filter((v) => v > 0))) ) - 0.2;
  const yMax = Math.log10(Math.max(...ys)) + 0.2;

  const px = (n: number) =>
    M.left + ((Math.log10(Math.max(1, n)) - xMin) / Math.max(0.001, xMax - xMin)) * (W - M.left - M.right);
  const py = (ops: number) =>
    H - M.bottom - ((Math.log10(Math.max(1, ops)) - yMin) / Math.max(0.001, yMax - yMin)) * (H - M.top - M.bottom);

  // Both are a few dozen iterations — memoising them would cost more in
  // dependency bookkeeping than it saves.
  const curvePoints: string[] = [];
  const SAMPLES = 48;
  for (let k = 0; k <= SAMPLES; k++) {
    const n = Math.pow(10, xMin + ((xMax - xMin) * k) / SAMPLES);
    curvePoints.push(`${px(n).toFixed(1)},${py(report.best.c * report.best.model.f(n)).toFixed(1)}`);
  }
  const curve = curvePoints.join(' ');

  // Decades alone leave an efficient algorithm with a single gridline, so fall
  // back to 1-2-5 steps when the measured range spans less than a couple of them.
  const inBand = (v: number) => py(v) > M.top - 4 && py(v) < H - M.bottom + 4;
  const decades: number[] = [];
  for (let e = Math.floor(yMin); e <= Math.ceil(yMax); e++) {
    const v = Math.pow(10, e);
    if (inBand(v)) decades.push(v);
  }
  let yTicks = decades;
  if (decades.length < 3) {
    const fine: number[] = [];
    for (let e = Math.floor(yMin) - 1; e <= Math.ceil(yMax) + 1; e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (inBand(v)) fine.push(v);
      }
    }
    if (fine.length >= decades.length) yTicks = fine.slice(0, 8);
  }

  const budgetY = py(report.projection.budget);
  const showBudget = budgetOnScale && budgetY > M.top && budgetY < H - M.bottom;

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={report.summary}
        >
          {/* grid */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={M.left}
                y1={py(v)}
                x2={W - M.right}
                y2={py(v)}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
              <text
                x={M.left - 8}
                y={py(v) + 4}
                textAnchor="end"
                fontFamily="var(--font-mono)"
                fontSize="10"
                fill="var(--faint)"
              >
                {yTicks.length > decades.length ? compactN(v) : powerLabel(v)}
              </text>
            </g>
          ))}
          {report.points.map((p) => (
            <g key={p.n}>
              <line
                x1={px(p.n)}
                y1={M.top}
                x2={px(p.n)}
                y2={H - M.bottom}
                stroke="var(--hairline)"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <text
                x={px(p.n)}
                y={H - M.bottom + 16}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="10"
                fill="var(--faint)"
              >
                {compactN(p.n)}
              </text>
            </g>
          ))}

          {/* axis labels */}
          <text
            x={(M.left + W - M.right) / 2}
            y={H - 8}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--muted)"
          >
            input size n  (log scale)
          </text>
          <text
            x={14}
            y={(M.top + H - M.bottom) / 2}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--muted)"
            transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}
          >
            operations counted  (log scale)
          </text>

          {/* judge budget */}
          {showBudget && (
            <g>
              <line
                x1={M.left}
                y1={budgetY}
                x2={W - M.right}
                y2={budgetY}
                stroke="var(--danger)"
                strokeWidth="1.2"
                strokeDasharray="5 4"
              />
              <text
                x={W - M.right + 6}
                y={budgetY + 4}
                fontFamily="var(--font-mono)"
                fontSize="10"
                fill="var(--danger)"
              >
                ~10⁸ judge
              </text>
            </g>
          )}

          {/* fitted model */}
          <polyline points={curve} fill="none" stroke="var(--accent)" strokeWidth="1.6" opacity="0.75" />

          {/* projection */}
          <g>
            <circle cx={px(report.projection.n)} cy={py(report.projection.ops)} r="4" fill="none" stroke="var(--probe)" strokeWidth="1.6" />
            <text
              x={px(report.projection.n)}
              y={py(report.projection.ops) - 10}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--probe)"
            >
              projected
            </text>
          </g>

          {/* measured points */}
          {report.points.map((p) => (
            <circle key={p.n} cx={px(p.n)} cy={py(p.ops)} r="3.5" fill="var(--accent)" />
          ))}
        </svg>
      </div>

      <div
        className={[
          'rounded-[7px] border p-3.5',
          report.projection.withinBudget
            ? 'border-accent-edge bg-accent-dim'
            : 'border-danger-edge bg-danger-dim',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-lg text-ink">{report.best.model.notation}</span>
          <span className="font-mono text-[0.68rem] text-muted">
            measured · R² = {report.best.r2.toFixed(4)}
          </span>
          <span className="ml-auto font-mono text-[0.68rem] text-muted">
            declared: {def.complexity.time}
          </span>
        </div>
        <p className="mt-2 text-[0.85rem] leading-snug text-ink-2">{report.summary}</p>
        {!budgetOnScale && (
          <p className="mt-2 border-t border-accent-edge pt-2 font-mono text-[0.68rem] text-muted">
            A judge&rsquo;s ~10⁸ budget is far above this chart — this algorithm never comes close
            to it.
          </p>
        )}
      </div>

      <div>
        <p className="label mb-2">What the counters actually said</p>
        <div className="overflow-x-auto rounded-[7px] border border-hairline">
          <table className="w-full min-w-[420px] font-mono text-xs">
            <thead>
              <tr className="border-b border-hairline bg-sunk text-faint">
                <th className="px-3 py-2 text-left font-medium">n</th>
                <th className="px-3 py-2 text-right font-medium">operations</th>
                <th className="px-3 py-2 text-right font-medium">n grew by</th>
                <th className="px-3 py-2 text-right font-medium">work grew by</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={r.n} className={i % 2 ? 'bg-panel' : 'bg-sunk/50'}>
                  <td className="px-3 py-1.5 tabular-nums text-ink-2">{r.n.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                    {r.ops.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                    {r.nRatio ? `${r.nRatio.toFixed(1)}×` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-accent">
                    {r.opsRatio ? `${r.opsRatio.toFixed(1)}×` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.78rem] leading-snug text-muted">{def.complexity.note}</p>
      </div>

      <div>
        <p className="label mb-2">How well each growth family fits</p>
        <div className="flex flex-col gap-1">
          {report.ranked.slice(0, 5).map((f) => (
            <div key={f.model.key} className="flex items-center gap-3">
              <span className="w-20 shrink-0 font-mono text-[0.7rem] text-ink-2">
                {f.model.notation}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
                <div
                  className={f.model.key === report.best.model.key ? 'h-full bg-accent' : 'h-full bg-hairline-strong'}
                  style={{ width: `${Math.max(0, Math.min(1, f.r2)) * 100}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[0.65rem] tabular-nums text-faint">
                {f.r2 > 0 ? f.r2.toFixed(3) : '—'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[0.78rem] leading-snug text-muted">
          Fitted across {MODELS.length} candidate families. A high score for several neighbouring
          families is normal at small n — the separation appears as n grows.
        </p>
      </div>
    </div>
  );
}
