import { COUNT_CAP, PROBE_CAP, StepCapExceeded, Tracer } from '../trace/tracer';
import { annotateInvariant } from '../trace/lens';
import { Lens, Scalar, Trace } from '../trace/types';

export type Category =
  | 'searching'
  | 'sorting'
  | 'strings'
  | 'linked-list'
  | 'trees'
  | 'graphs'
  | 'dp';

/**
 * Displayed source language. Every language for a given algorithm is a strict
 * line-for-line transliteration, so a step's line number means the same thing
 * whichever tab the reader is on. That is not a stylistic preference — the
 * trace records line numbers, so if the versions ever drift out of alignment
 * the code panel highlights the wrong statement.
 */
export type Lang = 'cpp' | 'c' | 'java';

export const LANGS: Lang[] = ['cpp', 'c', 'java'];

export const LANG_LABEL: Record<Lang, string> = {
  cpp: 'C++',
  c: 'C',
  java: 'Java',
};

export interface Input {
  array?: number[];
  target?: number;
  [k: string]: unknown;
}

/** The set of mutations currently switched on. */
export type MutationSet = ReadonlySet<string>;

export type RunFn = (input: Input, t: Tracer, mut: MutationSet) => Scalar;

/**
 * A single editable decision in the algorithm's source.
 *
 * Mutations are the unit everything else is built from: a "buggy variant" is
 * just a named set of them, and the palette lets a reader switch them on one
 * at a time and watch what happens.
 *
 * The replacement is scoped to one line and never changes the line count, so
 * `t.step(line, …)` stays valid no matter which combination is active. That
 * matters — a variant that deleted a line would silently shift every line
 * number below it and the code panel would highlight the wrong statement.
 */
export interface MutationEdit {
  /** 1-based line of the displayed source. */
  line: number;
  /** Exact text to find on that line. */
  from: string;
  /** What it becomes. Same line, so numbering is unaffected. */
  to: string;
  /**
   * Languages this edit applies to. Omitted means all of them — most edits
   * touch a statement that reads identically in C, C++ and Java. Declarations
   * and container access are where they diverge, and those get one edit each.
   */
  langs?: Lang[];
}

export interface Mutation {
  id: string;
  /** Some decisions live in more than one place — saving a pointer and then
   *  using it, say — so a mutation may rewrite several lines at once. */
  edits: MutationEdit[];
  /** Short chip label — what the code will say. */
  label: string;
  /** One line on what this changes about the algorithm's behaviour. */
  note: string;
}

/** A named point in mutation space, with authored prose about why it breaks. */
export interface Variant {
  id: string;
  label: string;
  /** Shown before the reveal — names the symptom, not the cause. */
  blurb: string;
  /** Authored, shown only after divergence has been located deterministically. */
  explanation: string;
  /** The mutation ids this preset switches on. */
  mutations: string[];
}

export interface InputField {
  key: string;
  label: string;
  /**
   * How the reader edits it, and how it travels in a link.
   *
   * `grid` is a rectangle of 0/1 — open and blocked — edited by clicking, which
   * is the only sane way to enter a maze. `text` is a short word for the string
   * problems; both are validated on the way back in from a URL.
   */
  kind: 'array' | 'number' | 'text' | 'grid';
  help?: string;
}

export interface EdgeCase {
  id: string;
  label: string;
  input: Input;
  why: string;
}

export interface CheckpointDef {
  /** Step index to quiz on; -1 to skip for this particular trace. */
  locate: (trace: Trace) => number;
  question: (trace: Trace, at: number) => string;
  options: (trace: Trace, at: number) => string[];
  answer: (trace: Trace, at: number) => string;
  because: (trace: Trace, at: number) => string;
}

/**
 * The reader's own implementation of this algorithm.
 *
 * Only offered for algorithms that fit in one function — the instrumenter
 * probes the function it is given and does not follow calls into helpers, so
 * a recursive implementation would trace only its outermost call and quietly
 * look wrong. Better to not offer the lane than to show a half-trace.
 */
export interface UserLane {
  /** Function the reader is asked to write. */
  fnName: string;
  /**
   * A correct implementation to start from in each language — edit it and
   * watch it break. A language with no starter here is not offered, which is
   * how a recursive algorithm stays out of the JavaScript lane: that lane
   * instruments source for the browser's own engine and does not follow calls
   * into helpers, so merge sort would trace only its outermost call and
   * quietly look wrong. The C-family lane is a real interpreter and traces the
   * whole call tree, so those algorithms are offered there and nowhere else.
   */
  starters: Partial<Record<UserLang, string>>;
  /** Whether the answer is the return value or the array left behind. */
  compareBy: 'return' | 'array';
  /**
   * Inputs the algorithm is not defined on, and so are not fair to test with.
   * Kadane's, for instance, reads `arr[0]` before the loop: there is no
   * answer for an empty array, only a convention, and grading the reader
   * against a convention teaches nothing.
   */
  precondition?: (input: Input) => boolean;
  /**
   * What the entry function's parameters receive. Defaults to the array.
   *
   * The shapes are built for the reader rather than typed by them — a tree, a
   * maze, an adjacency list — and which parameter gets which is decided by
   * name, with the rule printed under the editor. See `usercode/bind.ts`.
   */
  binds?: LaneBinding;
  /** How the edge list is read, for the two graph bindings. */
  graph?: { directed: boolean; fallback: string };
  /**
   * Turn the reader's answer into the string the reference prints.
   *
   * Only the graph lanes need this, and for one reason: the reference answers
   * in the node names from the edge list (`a:2 b:5`), while a function
   * returning `vector<int>` can only answer in indices. Relabelling is a
   * translation between two spellings of the same answer — it never repairs a
   * wrong one, and a wrong count of nodes still comes out wrong.
   */
  normalise?: (returned: string, input: Input, lane: UserLane) => string;
  /** One extra sentence for the editor, where a lane has a convention of its own. */
  note?: string;
}

/** The shape a lane's parameters are filled from. */
export type LaneBinding =
  | 'array'
  | 'list'
  | 'tree'
  | 'grid'
  | 'graph'
  | 'weighted'
  | 'word'
  | 'words';

/** The languages a reader can actually write in. */
export type UserLang = Lang | 'js';

export const USER_LANGS: UserLang[] = ['cpp', 'c', 'java', 'js'];

export const USER_LANG_LABEL: Record<UserLang, string> = { ...LANG_LABEL, js: 'JavaScript' };

/** The languages this particular lane has a starter for, in display order. */
export const laneLangs = (lane: UserLane): UserLang[] =>
  USER_LANGS.filter((l) => lane.starters[l] !== undefined);

export interface AlgorithmDef {
  slug: string;
  name: string;
  category: Category;
  tagline: string;
  intuition: string[];
  code: Record<Lang, string>;
  lens: Lens;
  run: RunFn;
  defaultInput: Input;
  fields: InputField[];
  /** Returns an error message when the input violates the algorithm's assumptions. */
  validate?: (input: Input) => string | null;
  makeInput: (n: number) => Input;
  growthSizes: number[];
  projectTo: number;
  complexity: { time: string; space: string; note: string };
  userLane?: UserLane;
  mutations: Mutation[];
  variants: Variant[];
  edgeCases: EdgeCase[];
  checkpoints: CheckpointDef[];
}

const EMPTY: MutationSet = new Set<string>();

export const asSet = (ids?: Iterable<string> | null): MutationSet =>
  ids ? new Set(ids) : EMPTY;

/** The mutations a named variant switches on. */
export function variantMutations(def: AlgorithmDef, variantId: string | null): MutationSet {
  if (!variantId) return EMPTY;
  const v = def.variants.find((x) => x.id === variantId);
  return asSet(v?.mutations);
}

/**
 * The source as it reads with these mutations applied. Line-scoped, so the
 * result always has the same number of lines as the original.
 */
export function codeFor(def: AlgorithmDef, active: MutationSet, lang: Lang = 'cpp'): string {
  const base = def.code[lang] ?? def.code.cpp;
  if (active.size === 0) return base;
  const lines = base.split('\n');
  for (const m of def.mutations) {
    if (!active.has(m.id)) continue;
    for (const e of m.edits) {
      if (e.langs && !e.langs.includes(lang)) continue;
      const i = e.line - 1;
      if (lines[i] !== undefined && lines[i].includes(e.from)) {
        lines[i] = lines[i].replace(e.from, e.to);
      }
    }
  }
  return lines.join('\n');
}

/** Line numbers touched by the active mutations, for the code panel. */
export function mutatedLines(
  def: AlgorithmDef,
  active: MutationSet,
  lang: Lang = 'cpp',
): number[] {
  return def.mutations
    .filter((m) => active.has(m.id))
    .flatMap((m) => m.edits.filter((e) => !e.langs || e.langs.includes(lang)).map((e) => e.line));
}

/** Run an algorithm under a set of mutations and produce an annotated trace. */
export function buildTrace(
  def: AlgorithmDef,
  input: Input,
  active: MutationSet = EMPTY,
): Trace {
  const t = new Tracer('trace');
  let result: Scalar = null;
  try {
    result = def.run(input, t, active);
  } catch (err) {
    // Hitting the cap is not a crash — it is the algorithm failing to finish,
    // which is a thing an implementation can do and a thing worth naming. The
    // steps recorded up to that point are kept and shown.
    result = err instanceof StepCapExceeded
      ? 'did not terminate'
      : `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const label = active.size ? [...active].sort().join('+') : 'reference';
  const trace = t.finish(def.slug, label, codeFor(def, active), result);
  return annotateInvariant(trace, def.lens);
}

/**
 * What the algorithm returns on this input, without recording a trace.
 *
 * The counterexample search asks this question hundreds of times and needs
 * nothing else from the run, so building a full step-by-step snapshot for each
 * one is pure waste — on a cubic algorithm it is most of the cost of the whole
 * test suite. The full trace is built once, for the input that wins.
 */
export function resultOf(def: AlgorithmDef, input: Input, active: MutationSet = EMPTY): Scalar {
  const t = new Tracer('count', PROBE_CAP);
  try {
    return def.run(input, t, active);
  } catch (err) {
    // "It never finished" is a different answer from "it threw", and both are
    // different from any value the algorithm could have returned — so both are
    // reported as themselves. A run that does not terminate is the loudest
    // possible counterexample, and collapsing it into an error string would
    // hide that.
    if (err instanceof StepCapExceeded) return 'did not terminate';
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Re-run with counters only, for growth measurement. */
export function countOps(def: AlgorithmDef, input: Input): number {
  const t = new Tracer('count', COUNT_CAP);
  try {
    def.run(input, t, EMPTY);
  } catch {
    /* growth measurement never fails the page */
  }
  const c = t.counters;
  return c.comparisons + c.reads + c.writes + c.calls;
}

/**
 * Peak memory the algorithm held beyond its input and its answer.
 *
 * Two things are counted and they are genuinely comparable: cells of working
 * storage, and frames on the call stack. A recursive sort that allocates
 * nothing still needs somewhere to remember where it was, and a loop that
 * allocates a scratch array still needs the array — both are memory that grows
 * with n, and an algorithm is bounded by whichever of them dominates.
 *
 * Every algorithm returns at least 1: something is always held.
 */
export function countSpace(def: AlgorithmDef, input: Input): number {
  const t = new Tracer('count', COUNT_CAP);
  try {
    def.run(input, t, EMPTY);
  } catch {
    /* growth measurement never fails the page */
  }
  return Math.max(1, t.counters.auxPeak + t.counters.maxDepth);
}
