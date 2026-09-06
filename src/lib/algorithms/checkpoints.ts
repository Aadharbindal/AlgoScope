import { Step, Trace } from '../trace/types';
import { CheckpointDef } from './types';

/**
 * Predict-then-reveal questions, made cheap to author.
 *
 * This is the one thing on the site that a video structurally cannot do: stop
 * at the step where the concept lives and ask what happens next, before showing
 * it. A player that asks one question per algorithm is not doing that — it is
 * gesturing at it — so the shapes below exist to make writing four or five per
 * algorithm no more work than writing one.
 *
 * Two shapes cover almost everything. `conceptual` asks about the idea and its
 * answer is the same whatever the input. `computed` asks about this particular
 * run and reads its answer out of the trace. Anything that needs more than
 * those is written out longhand, which is still allowed and sometimes right.
 */

/** Where a question lands: the nth step that ran a given line. */
export interface Where {
  line: number;
  /** 0-based occurrence of that line. Negative counts back from the last. */
  nth?: number;
  /** Narrow further — the first matching step is used. */
  when?: (step: Step, trace: Trace) => boolean;
}

function locator(where: Where): CheckpointDef['locate'] {
  return (trace) => {
    const hits = trace.steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.line === where.line && (where.when?.(s, trace) ?? true));
    if (hits.length === 0) return -1;
    const nth = where.nth ?? 0;
    const pick = nth < 0 ? hits[hits.length + nth] : hits[nth];
    // Step 0 has no "before" to predict from, so a question there is useless.
    return pick && pick.i >= 1 ? pick.i : -1;
  };
}

/**
 * A question about the idea, with a fixed set of answers.
 *
 * The distractors matter as much as the answer. Each one should be a thing a
 * reader might actually believe at that moment — a plausible misreading of the
 * line, not a filler option that nobody would pick.
 */
export function conceptual(spec: {
  where: Where;
  question: string;
  options: string[];
  answer: string;
  because: string;
}): CheckpointDef {
  if (!spec.options.includes(spec.answer)) {
    throw new Error(`checkpoint answer "${spec.answer}" is not among its own options`);
  }
  return {
    locate: locator(spec.where),
    question: () => spec.question,
    options: () => spec.options,
    answer: () => spec.answer,
    because: () => spec.because,
  };
}

/**
 * A question about this run, answered from the trace.
 *
 * `options` receives the correct answer so the distractors can be built around
 * it, and the result is de-duplicated and always contains it — a checkpoint
 * whose right answer is missing from its own list is a bug that would otherwise
 * only show up in front of a reader.
 */
export function computed(spec: {
  where: Where;
  question: (step: Step, trace: Trace) => string;
  answer: (step: Step, trace: Trace) => string;
  options: (answer: string, step: Step, trace: Trace) => string[];
  /** Most explanations are about the idea and do not vary with the run. */
  because: string | ((step: Step, trace: Trace) => string);
}): CheckpointDef {
  const because = typeof spec.because === 'string' ? () => spec.because as string : spec.because;
  return {
    locate: locator(spec.where),
    question: (trace, at) => spec.question(trace.steps[at], trace),
    answer: (trace, at) => spec.answer(trace.steps[at], trace),
    options: (trace, at) => {
      const step = trace.steps[at];
      const answer = spec.answer(step, trace);
      return [...new Set([answer, ...spec.options(answer, step, trace)])];
    },
    because: (trace, at) => because(trace.steps[at], trace),
  };
}

/** Read a variable off a step as a number, for the common numeric question. */
export const num = (step: Step, name: string): number => Number(step.vars[name]);

/** Read it as a string, for ids and labels. */
export const str = (step: Step, name: string): string => String(step.vars[name]);
