import { AlgorithmDef, buildTrace, Input, MutationSet, resultOf } from '../algorithms/types';
import { Divergence, findDivergence } from './diff';

/**
 * Counterexample search.
 *
 * A bug that does not show up on the input in front of you is the worst kind.
 * Rather than asking a model to guess when an implementation breaks, run both
 * implementations over a spread of candidate inputs and report the smallest
 * one on which they actually disagree.
 *
 * Entirely deterministic, and it is the same machinery that will point a
 * student's own failing submission at a minimal reproducer.
 */

export interface Counterexample {
  input: Input;
  divergence: Divergence;
  /** How the input was found, so the UI can be honest about it. */
  source: 'default' | 'edge-case' | 'generated';
  label: string;
  /**
   * Whether the broken run actually returns a different answer here, or merely
   * takes a different path to the same one.
   *
   * This distinction is the difference between a bug and a smell, and it has to
   * be visible. A loop that reads one element past the end of the array returns
   * the right answer every time on this site — the extra read is the only trace
   * of it — while a loop that starts at the wrong index returns the wrong
   * index. Showing both as "found the bug" without saying which is which
   * teaches that all bugs announce themselves, and they do not.
   */
  answerDiffers: boolean;
  /** What the correct run returned, and what this one did. */
  correct: string;
  yours: string;
}

const size = (input: Input) => (input.array?.length ?? 0);

/** Small, structurally varied arrays — the shapes that break index bounds. */
function* generatedInputs(def: AlgorithmDef): Generator<{ input: Input; label: string }> {
  const shapes: { values: number[]; label: string }[] = [
    { values: [], label: 'empty' },
    { values: [1], label: 'single element' },
    { values: [1, 2], label: 'two ascending' },
    { values: [2, 1], label: 'two descending' },
    { values: [1, 1], label: 'two equal' },
    { values: [1, 2, 3], label: 'three ascending' },
    { values: [3, 2, 1], label: 'three descending' },
    { values: [2, 1, 3], label: 'three unsorted' },
    { values: [1, 2, 3, 4], label: 'four ascending' },
    { values: [4, 3, 2, 1], label: 'four descending' },
    { values: [1, 3, 2, 4], label: 'four with one inversion' },
    { values: [1, 2, 3, 4, 5], label: 'five ascending' },
    { values: [5, 1, 4, 2, 3], label: 'five shuffled' },
    { values: [1, 2, 3, 4, 5, 6, 7], label: 'seven ascending' },
  ];

  // These shapes are arrays, so they only mean anything to an algorithm that
  // takes one. Handing `{ array: [...] }` to a maze or a pair of words would
  // produce a list of identical candidates wearing different labels — every
  // one of them silently falling back to the default input.
  if (!def.fields.some((f) => f.kind === 'array')) return;

  const wantsTarget = def.fields.some((f) => f.key === 'target');

  for (const shape of shapes) {
    if (!wantsTarget) {
      yield { input: { array: shape.values }, label: shape.label };
      continue;
    }
    // Probe every element plus one value that is absent.
    const sorted = [...shape.values].sort((a, b) => a - b);
    const targets = [...new Set([...sorted, (sorted[sorted.length - 1] ?? 0) + 1])];
    for (const target of targets) {
      yield {
        input: { array: sorted, target },
        label: `${shape.label}, target ${target}`,
      };
    }
  }
}

/** Everything worth trying, cheapest and most familiar first. */
export function candidateInputs(
  def: AlgorithmDef,
): { input: Input; label: string; source: Counterexample['source'] }[] {
  return [
    { input: def.defaultInput, label: 'the default input', source: 'default' },
    ...def.edgeCases.map((e) => ({ input: e.input, label: e.label, source: 'edge-case' as const })),
    ...[...generatedInputs(def)].map((g) => ({ ...g, source: 'generated' as const })),
  ];
}

/**
 * Find the smallest input on which `variantId` disagrees with the reference.
 * Returns null when the two agree on everything tried — which is not proof of
 * equivalence, and the UI says so.
 */
/**
 * Find the input that best exposes a set of mutations.
 *
 * Ranked, and the ranking is the whole of it. A wrong *answer* beats a
 * different *path* every time: the reader has clicked "show me this bug", and
 * an input on which the broken version quietly returns the correct result is
 * the least convincing thing that could be put in front of them. Only when no
 * tested input produces a wrong answer does this fall back to trace divergence
 * — and then it says so, because "this changes what the code does without
 * changing what it returns" is a real category and worth naming.
 *
 * Within each rank the default input wins, so a reader sees the bug on the
 * example they were already looking at; failing that, the smallest input that
 * shows it.
 */
export function findCounterexample(
  def: AlgorithmDef,
  mutations: MutationSet,
  budget = 400,
): Counterexample | null {
  if (mutations.size === 0) return null;
  const candidates = candidateInputs(def);

  type Hit = (typeof candidates)[number] & { correct: string; yours: string };

  // Pass one asks only what each run returned. That question does not need a
  // trace, and building one for every candidate is most of the cost.
  let best: Hit | null = null;
  let tried = 0;

  for (const candidate of candidates) {
    if (tried++ > budget) break;
    let correct: string;
    let yours: string;
    try {
      correct = String(resultOf(def, candidate.input));
      yours = String(resultOf(def, candidate.input, mutations));
    } catch {
      continue;
    }
    if (correct === yours) continue;

    const hit: Hit = { ...candidate, correct, yours };
    // The default input first, so the reader sees the bug on the example they
    // were already looking at; failing that, the smallest input that shows it.
    if (candidate.source === 'default') {
      best = hit;
      break;
    }
    if (!best || size(candidate.input) < size(best.input)) best = hit;
    // Generated shapes come smallest first, so nothing later can beat this.
    if (candidate.source === 'generated') break;
  }

  // Pass two: only now is a trace worth building, and only for one input.
  if (best) {
    const divergence = traceDivergence(def, best.input, mutations);
    if (divergence) {
      return {
        input: best.input,
        divergence,
        source: best.source,
        label: best.label,
        answerDiffers: true,
        correct: best.correct,
        yours: best.yours,
      };
    }
  }

  // Nothing changed the answer anywhere it was tried. Some mutations really are
  // like this — reading one element past the end of an array returns the right
  // result every time here, and the extra read is the only evidence it happened
  // at all. Fall back to path divergence, and say that is what it is.
  for (const candidate of candidates.slice(0, 12)) {
    const divergence = traceDivergence(def, candidate.input, mutations);
    if (!divergence) continue;
    return {
      input: candidate.input,
      divergence,
      source: candidate.source,
      label: candidate.label,
      answerDiffers: false,
      correct: String(resultOf(def, candidate.input)),
      yours: String(resultOf(def, candidate.input, mutations)),
    };
  }

  return null;
}

/** Where the two runs first part company, or null if they never do. */
function traceDivergence(def: AlgorithmDef, input: Input, mutations: MutationSet): Divergence | null {
  try {
    return findDivergence(buildTrace(def, input), buildTrace(def, input, mutations));
  } catch {
    return null;
  }
}
