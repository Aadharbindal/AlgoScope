'use client';

import { create } from 'zustand';
import { AlgorithmDef, buildTrace, Input, Lang } from '@/lib/algorithms/types';
import { Divergence, findDivergence } from '@/lib/trace/diff';
import { Trace } from '@/lib/trace/types';

export type Density = 'focus' | 'normal' | 'full';

/**
 * What the counterexample search found, kept whole rather than reduced to a
 * label.
 *
 * `answerDiffers` is the field that matters. A bug that returns the wrong
 * answer and a bug that returns the right answer by a different route are not
 * the same kind of thing, and a panel that reports both as "found it" teaches
 * that every bug announces itself. Most do not.
 */
export interface CeOutcome {
  label: string;
  answerDiffers: boolean;
  correct: string;
  yours: string;
}

export interface CheckpointState {
  /** Step index the question guards. */
  at: number;
  question: string;
  options: string[];
  answer: string;
  because: string;
  picked: string | null;
}

/** Which named variant, if any, this exact set of mutations corresponds to. */
export function matchVariant(def: AlgorithmDef, mutations: string[]): string | null {
  const set = new Set(mutations);
  for (const v of def.variants) {
    if (v.mutations.length === set.size && v.mutations.every((m) => set.has(m))) return v.id;
  }
  return null;
}

interface PlayerState {
  def: AlgorithmDef | null;
  input: Input;
  /** The single source of truth for what the code says and does. */
  mutations: string[];

  trace: Trace | null;
  /** Unmutated run, kept whenever any mutation is on, for divergence. */
  reference: Trace | null;
  divergence: Divergence | null;

  step: number;
  playing: boolean;
  speed: number;

  /**
   * How the current input was arrived at when it came from a counterexample
   * search, and what the two runs actually returned on it. Lives with the trace
   * it describes rather than in view state.
   */
  ce: CeOutcome | null;

  /**
   * Which language the source is displayed in. A display choice only — every
   * language is a line-for-line transliteration of the same algorithm, so the
   * trace is unaffected and switching does not rebuild anything.
   */
  lang: Lang;

  density: Density;
  quizEnabled: boolean;
  checkpoints: CheckpointState[];
  /** Checkpoint currently blocking forward progress, if any. */
  blocking: number | null;

  load: (def: AlgorithmDef, input?: Input, mutations?: string[]) => void;
  setInput: (input: Input) => void;
  setMutations: (mutations: string[]) => void;
  toggleMutation: (id: string) => void;
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  nextEvent: (dir: 1 | -1) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setDensity: (density: Density) => void;
  setLang: (lang: Lang) => void;
  setQuizEnabled: (on: boolean) => void;
  answer: (at: number, picked: string) => void;
  dismissBlocking: () => void;
  setCe: (ce: CeOutcome | null) => void;
}

function buildCheckpoints(def: AlgorithmDef, trace: Trace): CheckpointState[] {
  const out: CheckpointState[] = [];
  for (const cp of def.checkpoints) {
    let at = -1;
    try {
      at = cp.locate(trace);
    } catch {
      at = -1;
    }
    if (at < 1 || at >= trace.steps.length) continue;
    try {
      const options = cp.options(trace, at);
      const answer = cp.answer(trace, at);
      if (!options.includes(answer)) continue;
      out.push({
        at,
        question: cp.question(trace, at),
        options,
        answer,
        because: cp.because(trace, at),
        picked: null,
      });
    } catch {
      /* a checkpoint that cannot be built for this input is simply skipped */
    }
  }
  return out;
}

function rebuild(def: AlgorithmDef, input: Input, mutations: string[]) {
  const active = new Set(mutations);
  const trace = buildTrace(def, input, active);
  const reference = active.size ? buildTrace(def, input) : null;
  const divergence = reference ? findDivergence(reference, trace) : null;
  return { trace, reference, divergence, checkpoints: buildCheckpoints(def, trace) };
}

export const usePlayer = create<PlayerState>((set, get) => ({
  def: null,
  input: {},
  mutations: [],
  trace: null,
  reference: null,
  divergence: null,
  step: 0,
  playing: false,
  speed: 1,
  ce: null,
  lang: 'cpp',
  density: 'normal',
  quizEnabled: true,
  checkpoints: [],
  blocking: null,

  load: (def, input, mutations = []) => {
    const nextInput = input ?? def.defaultInput;
    let lang = get().lang;
    try {
      const saved = window.localStorage.getItem('algoscope:lang');
      if (saved === 'cpp' || saved === 'c' || saved === 'java') lang = saved;
    } catch {
      /* fall back to the default */
    }
    set({
      lang,
      def,
      input: nextInput,
      mutations,
      step: 0,
      playing: false,
      blocking: null,
      ...rebuild(def, nextInput, mutations),
    });
  },

  setInput: (input) => {
    const { def, mutations } = get();
    if (!def) return;
    // The input is now the user's choice, not something a search produced.
    set({
      input,
      step: 0,
      playing: false,
      blocking: null,
      ce: null,
      ...rebuild(def, input, mutations),
    });
  },

  setMutations: (mutations) => {
    const { def, input } = get();
    if (!def) return;
    set({ mutations, step: 0, playing: false, blocking: null, ...rebuild(def, input, mutations) });
  },

  toggleMutation: (id) => {
    const { def, input, mutations } = get();
    if (!def) return;
    const next = mutations.includes(id)
      ? mutations.filter((m) => m !== id)
      : [...mutations, id];
    set({
      mutations: next,
      step: 0,
      playing: false,
      blocking: null,
      ce: null,
      ...rebuild(def, input, next),
    });
  },

  setStep: (step) => {
    const { trace } = get();
    if (!trace) return;
    const clamped = Math.max(0, Math.min(trace.steps.length - 1, step));
    set({ step: clamped, blocking: null });
  },

  next: () => {
    const { trace, step, checkpoints, quizEnabled } = get();
    if (!trace) return;
    const target = step + 1;
    if (target > trace.steps.length - 1) {
      set({ playing: false });
      return;
    }
    if (quizEnabled) {
      const idx = checkpoints.findIndex((c) => c.at === target && c.picked === null);
      if (idx >= 0) {
        set({ blocking: idx, playing: false });
        return;
      }
    }
    set({ step: target });
  },

  prev: () => {
    const { step } = get();
    set({ step: Math.max(0, step - 1), blocking: null, playing: false });
  },

  first: () => set({ step: 0, blocking: null, playing: false }),

  last: () => {
    const { trace } = get();
    if (!trace) return;
    set({ step: trace.steps.length - 1, blocking: null, playing: false });
  },

  /** Jump to the next step that carries an event — the interesting moments. */
  nextEvent: (dir) => {
    const { trace, step } = get();
    if (!trace) return;
    let i = step + dir;
    while (i >= 0 && i < trace.steps.length) {
      if (trace.steps[i].event) break;
      i += dir;
    }
    if (i < 0 || i >= trace.steps.length) return;
    set({ step: i, blocking: null, playing: false });
  },

  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setDensity: (density) => set({ density }),

  setLang: (lang) => {
    set({ lang });
    try {
      window.localStorage.setItem('algoscope:lang', lang);
    } catch {
      /* private mode, or storage disabled — the choice just won't persist */
    }
  },
  setQuizEnabled: (quizEnabled) => set({ quizEnabled }),
  setCe: (ce) => set({ ce }),

  answer: (at, picked) => {
    const { checkpoints } = get();
    set({ checkpoints: checkpoints.map((c) => (c.at === at ? { ...c, picked } : c)) });
  },

  dismissBlocking: () => {
    const { blocking, checkpoints, step } = get();
    if (blocking === null) return;
    const cp = checkpoints[blocking];
    set({ blocking: null, step: cp ? cp.at : step + 1 });
  },
}));
