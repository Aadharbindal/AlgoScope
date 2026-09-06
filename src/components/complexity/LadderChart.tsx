import { formatOps } from '@/lib/trace/complexity';

/**
 * Every rung of a ladder on one pair of axes.
 *
 * Log-log, so a power law is a straight line and its slope is the exponent —
 * which turns "quadratic versus linear" from two words into two visibly
 * different angles. The curves are measured operation counts, not the model
 * that was fitted to them: a fitted curve would be a picture of the conclusion
 * rather than of the evidence.
 *
 * No hooks and no browser APIs, so the page that renders this can be static.
 */

export interface Series {
  label: string;
  notation: string;
  points: { n: number; ops: number }[];
}

/** Worst rung first, best last, so the ramp reads as an improvement. */
const RAMP = [
  'var(--danger)',
  'var(--probe)',
  'var(--info)',
  'var(--ink-2)',
  'var(--accent)',
];

const colourFor = (i: number, total: number) => {
  if (total <= 1) return RAMP[RAMP.length - 1];
  if (i === total - 1) return RAMP[RAMP.length - 1];
  return RAMP[Math.min(RAMP.length - 2, i)];
};

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const powerLabel = (v: number) => {
  const e = Math.round(Math.log10(v));
  if (e < 3) return String(Math.round(v));
  return `10${String(e)
    .split('')
    .map((d) => SUPS[Number(d)])
    .join('')}`;
};

const compactN = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function LadderChart({ series }: { series: Series[] }) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const W = 760;
  const H = 400;
  const M = { top: 20, right: 150, bottom: 46, left: 62 };

  const xMin = Math.log10(Math.max(2, Math.min(...all.map((p) => p.n))));
  const xMax = Math.log10(Math.max(...all.map((p) => p.n)));
  const yMin = Math.log10(Math.max(1, Math.min(...all.map((p) => p.ops).filter((v) => v > 0)))) - 0.15;
  const yMax = Math.log10(Math.max(...all.map((p) => p.ops))) + 0.15;

  const px = (n: number) =>
    M.left + ((Math.log10(Math.max(1, n)) - xMin) / Math.max(0.001, xMax - xMin)) * (W - M.left - M.right);
  const py = (ops: number) =>
    H - M.bottom - ((Math.log10(Math.max(1, ops)) - yMin) / Math.max(0.001, yMax - yMin)) * (H - M.top - M.bottom);

  const xTicks = [...new Set(series[0]?.points.map((p) => p.n) ?? [])];
  const yTicks: number[] = [];
  for (let e = Math.ceil(yMin); e <= Math.floor(yMax); e++) yTicks.push(10 ** e);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', minWidth: 560, height: 'auto' }}
        role="img"
        aria-label={`Measured operation counts for ${series.map((s) => s.label).join(', ')}, on log-log axes`}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} y1={py(v)} x2={W - M.right} y2={py(v)} stroke="var(--hairline)" strokeWidth={1} />
            <text
              x={M.left - 8}
              y={py(v)}
              textAnchor="end"
              dominantBaseline="central"
              fill="var(--faint)"
              style={{ font: '400 10px var(--font-geist-mono), ui-monospace, monospace' }}
            >
              {powerLabel(v)}
            </text>
          </g>
        ))}

        {xTicks.map((n) => (
          <text
            key={n}
            x={px(n)}
            y={H - M.bottom + 16}
            textAnchor="middle"
            fill="var(--faint)"
            style={{ font: '400 10px var(--font-geist-mono), ui-monospace, monospace' }}
          >
            {compactN(n)}
          </text>
        ))}

        <text
          x={(M.left + W - M.right) / 2}
          y={H - 8}
          textAnchor="middle"
          fill="var(--muted)"
          style={{ font: '400 10px var(--font-geist-mono), ui-monospace, monospace' }}
        >
          input size n
        </text>

        {series.map((s, i) => {
          const colour = colourFor(i, series.length);
          const d = s.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${px(p.n)} ${py(p.ops)}`).join(' ');
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" />
              {s.points.map((p) => (
                <circle key={p.n} cx={px(p.n)} cy={py(p.ops)} r={2.6} fill={colour} />
              ))}
              <text
                x={W - M.right + 10}
                y={py(last.ops)}
                dominantBaseline="central"
                fill={colour}
                style={{ font: '500 11px var(--font-geist-mono), ui-monospace, monospace' }}
              >
                {s.notation}
              </text>
              <text
                x={W - M.right + 10}
                y={py(last.ops) + 13}
                dominantBaseline="central"
                fill="var(--faint)"
                style={{ font: '400 10px var(--font-geist-mono), ui-monospace, monospace' }}
              >
                {s.label}
              </text>
            </g>
          );
        })}

        <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} stroke="var(--hairline-strong)" />
        <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} stroke="var(--hairline-strong)" />
      </svg>

      <p className="mt-2 text-[0.74rem] leading-snug text-faint">
        Operations counted by running each approach, at every size on the axis. Both axes are
        logarithmic, so each curve&rsquo;s slope is its exponent — parallel lines differ by a
        constant factor, diverging lines differ by a power. Largest measured:{' '}
        {series
          .map((s) => `${s.label} ${formatOps(s.points[s.points.length - 1].ops)}`)
          .join(', ')}
        .
      </p>
    </div>
  );
}
