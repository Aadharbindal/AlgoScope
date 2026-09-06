/**
 * Empirical complexity.
 *
 * We do not infer Big-O from source. We run the algorithm at increasing input
 * sizes, count the operations it actually performs, and fit a growth curve to
 * the measurements. The result is checkable, and it says something a symbol
 * does not: whether this code will finish inside a judge's time limit.
 *
 * The counts are educational operation counts — comparisons, reads, writes —
 * not wall-clock time and not machine instructions. The UI says so.
 */

export interface GrowthPoint {
  n: number;
  ops: number;
}

export type GrowthKey = 'const' | 'log' | 'linear' | 'linearithmic' | 'quadratic' | 'cubic' | 'exponential';

export interface Model {
  key: GrowthKey;
  notation: string;
  f: (n: number) => number;
}

export const MODELS: Model[] = [
  { key: 'const', notation: 'O(1)', f: () => 1 },
  { key: 'log', notation: 'O(log n)', f: (n) => Math.max(1, Math.log2(n)) },
  { key: 'linear', notation: 'O(n)', f: (n) => n },
  { key: 'linearithmic', notation: 'O(n log n)', f: (n) => n * Math.max(1, Math.log2(n)) },
  { key: 'quadratic', notation: 'O(n²)', f: (n) => n * n },
  { key: 'cubic', notation: 'O(n³)', f: (n) => n * n * n },
  { key: 'exponential', notation: 'O(2ⁿ)', f: (n) => Math.pow(2, Math.min(n, 40)) },
];

export interface Fit {
  model: Model;
  /** Multiplier c in ops ≈ c · f(n). */
  c: number;
  /** Goodness of fit in log space, where growth families actually separate. */
  r2: number;
}

/**
 * Fit ops ≈ c · f(n) by least squares on log(ops).
 * Log space matters: on raw counts the largest n dominates the residual and
 * n log n becomes indistinguishable from n².
 */
function fitModel(points: GrowthPoint[], model: Model): Fit {
  const usable = points.filter((p) => p.ops > 0 && model.f(p.n) > 0);
  if (usable.length < 2) return { model, c: 1, r2: 0 };

  const logs = usable.map((p) => Math.log(p.ops) - Math.log(model.f(p.n)));
  const logC = logs.reduce((a, b) => a + b, 0) / logs.length;
  const c = Math.exp(logC);

  const ys = usable.map((p) => Math.log(p.ops));
  const preds = usable.map((p) => logC + Math.log(model.f(p.n)));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ssRes = ys.reduce((acc, y, i) => acc + (y - preds[i]) ** 2, 0);
  const ssTot = ys.reduce((acc, y) => acc + (y - mean) ** 2, 0);
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

  return { model, c, r2 };
}

export interface RatioRow {
  n: number;
  ops: number;
  /** ops(n) / ops(previous n). */
  opsRatio: number | null;
  nRatio: number | null;
}

export interface ComplexityReport {
  points: GrowthPoint[];
  best: Fit;
  ranked: Fit[];
  rows: RatioRow[];
  projection: {
    n: number;
    ops: number;
    withinBudget: boolean;
    budget: number;
  };
  /** Deterministic sentence describing what was measured. */
  summary: string;
}

const OPS_BUDGET = 1e8; // the usual "operations per second" rule of thumb

export function analyseGrowth(
  points: GrowthPoint[],
  projectTo = 100_000,
  budget = OPS_BUDGET,
): ComplexityReport {
  const ranked = MODELS.map((m) => fitModel(points, m)).sort((a, b) => b.r2 - a.r2);
  const best = ranked[0];

  const rows: RatioRow[] = points.map((p, i) => ({
    n: p.n,
    ops: p.ops,
    opsRatio: i === 0 ? null : points[i - 1].ops === 0 ? null : p.ops / points[i - 1].ops,
    nRatio: i === 0 ? null : p.n / points[i - 1].n,
  }));

  const projectedOps = best.c * best.model.f(projectTo);
  const withinBudget = projectedOps <= budget;

  const summary =
    `Measured at ${points.length} input sizes from n = ${points[0]?.n ?? 0} to ` +
    `n = ${points[points.length - 1]?.n ?? 0}. Growth fits ${best.model.notation} ` +
    `(R² = ${best.r2.toFixed(4)}). Extrapolated to n = ${projectTo.toLocaleString()}, ` +
    `this performs about ${formatOps(projectedOps)} operations` +
    (withinBudget
      ? ', comfortably inside a typical judge budget.'
      : `, well past the ~${formatOps(budget)} a judge will usually allow. Expect a time limit failure.`);

  return {
    points,
    best,
    ranked,
    rows,
    projection: { n: projectTo, ops: projectedOps, withinBudget, budget },
    summary,
  };
}

export function formatOps(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}×10¹²`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}
