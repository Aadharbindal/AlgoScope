import { Scalar } from '../trace/types';

/**
 * Small predicates that postconditions are written against.
 *
 * Each one is computed by the instrumentation, published with `t.derive`, and
 * then referred to by name in a lens. They live here rather than inside each
 * algorithm so that "sorted" means the same thing in all five sorts — a
 * postcondition that quietly meant something slightly different per file would
 * be worse than no postcondition, because it would still read like one claim.
 *
 * Every one of these is computed from the algorithm's own output, never from
 * the oracle. Checking a result against a known answer proves only that the
 * two agree; checking it against the property the caller was promised proves
 * the thing the caller actually wanted.
 */

/** 1 when every adjacent pair is in order. An empty or one-element array is. */
export const sortedFlag = (xs: readonly number[]): Scalar => {
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] > xs[i]) return 0;
  return 1;
};

/** 1 when `xs` is a permutation of `ys` — nothing lost, nothing invented. */
export const permutationFlag = (xs: readonly number[], ys: readonly number[]): Scalar => {
  if (xs.length !== ys.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const b = [...ys].sort((p, q) => p - q);
  return a.every((v, i) => v === b[i]) ? 1 : 0;
};

/** 1 when every value appears exactly once. */
export const distinctFlag = (xs: readonly Scalar[]): Scalar =>
  new Set(xs.map(String)).size === xs.length ? 1 : 0;

/** 1 when the two strings match, for a result compared against an oracle. */
export const sameFlag = (a: string, b: string): Scalar => (a === b ? 1 : 0);
