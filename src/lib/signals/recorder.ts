'use client';

import { CheckpointSignal, SessionSignal, SIGNAL_VERSION, StepSignal } from './types';

/**
 * Counts what a reader did, in the reader's own tab, and sends one summary
 * when they leave.
 *
 * Nothing is sent while reading. There is no stream to intercept and no
 * ordering to reconstruct — by the time anything leaves the browser it is
 * already an aggregate over the visit. That is a deliberate constraint, not an
 * optimisation: a per-event feed of what a student clicked, second by second,
 * is a different and much more invasive product than a map of which lines are
 * hard, and this file can only produce the second one.
 */

const KEY = 'algoscope:signals';
const MAX_DWELL = 3600;

/** Off is remembered; on is the default and is stated on the page. */
export function signalsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    // Storage blocked — we cannot remember a refusal, so assume one.
    return false;
  }
}

export function setSignalsEnabled(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* nothing to do; the setting simply will not persist */
  }
}

const randomId = () => {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

interface Cell {
  line: number;
  visits: number;
  dwellMs: number;
}

export class SessionRecorder {
  private readonly session = randomId();
  private readonly startedAt = Date.now();
  private readonly cells = new Map<number, Cell>();
  private readonly checkpoints: CheckpointSignal[] = [];

  private current: number | null = null;
  private enteredAt = 0;
  private divergedAtLine: number | null = null;
  private finished = false;
  private sent = false;

  /** Reset per trace: a new input is a new run, with new step indices. */
  private steps = 0;

  constructor(
    private slug: string,
    private lang: string,
    private mutations: string[],
    private input: string,
  ) {}

  /**
   * A new trace replaced the old one. Step indices no longer mean what they
   * meant, so the per-step counts are dropped rather than carried over — but
   * checkpoints are keyed by line and survive.
   */
  retarget(lang: string, mutations: string[], input: string, steps: number) {
    if (input !== this.input || mutations.join(',') !== this.mutations.join(',')) {
      this.cells.clear();
      this.current = null;
    }
    this.lang = lang;
    this.mutations = mutations;
    this.input = input;
    this.steps = Math.max(this.steps, steps);
  }

  /** The reader is now looking at this step. */
  enter(i: number, line: number, total: number) {
    if (this.current === i) return;
    this.close();
    this.steps = Math.max(this.steps, total);
    const cell = this.cells.get(i) ?? { line, visits: 0, dwellMs: 0 };
    cell.line = line;
    cell.visits++;
    this.cells.set(i, cell);
    this.current = i;
    this.enteredAt = Date.now();
    if (i >= total - 1) this.finished = true;
  }

  /** A predict-then-reveal question was answered. Only the first try counts. */
  checkpoint(line: number, correct: boolean) {
    if (this.checkpoints.some((c) => c.line === line)) return;
    this.checkpoints.push({ line, correct });
  }

  /** The step where a broken run first parted from the reference. */
  diverged(line: number) {
    this.divergedAtLine = line;
  }

  private close() {
    if (this.current === null) return;
    const cell = this.cells.get(this.current);
    if (cell) cell.dwellMs += Date.now() - this.enteredAt;
  }

  build(): SessionSignal | null {
    this.close();
    if (this.cells.size === 0 || this.steps === 0) return null;

    const visited: StepSignal[] = [...this.cells.entries()]
      // Longest-held steps first, so the cap keeps the informative ones.
      .sort((a, b) => b[1].dwellMs + b[1].visits * 1000 - (a[1].dwellMs + a[1].visits * 1000))
      .slice(0, 400)
      .map(([i, c]) => ({
        i,
        line: c.line,
        visits: c.visits,
        dwell: Math.min(MAX_DWELL, Math.round(c.dwellMs / 1000)),
      }));

    const last = this.current === null ? null : (this.cells.get(this.current)?.line ?? null);

    return {
      v: SIGNAL_VERSION,
      session: this.session,
      slug: this.slug,
      lang: this.lang,
      mutations: this.mutations,
      input: this.input,
      steps: this.steps,
      visited,
      checkpoints: this.checkpoints,
      divergedAtLine: this.divergedAtLine,
      lastLine: last,
      finished: this.finished,
      duration: Math.min(MAX_DWELL, Math.round((Date.now() - this.startedAt) / 1000)),
    };
  }

  /**
   * Send once, on the way out.
   *
   * `sendBeacon` because a normal fetch is cancelled when the page unloads —
   * and an abandoned session is exactly the one worth knowing about.
   */
  flush() {
    if (this.sent || !signalsEnabled()) return;
    const signal = this.build();
    if (!signal) return;
    this.sent = true;
    try {
      const blob = new Blob([JSON.stringify(signal)], { type: 'application/json' });
      if (!navigator.sendBeacon('/api/signal', blob)) {
        void fetch('/api/signal', { method: 'POST', body: blob, keepalive: true });
      }
    } catch {
      /* a signal that cannot be sent is simply lost; nothing depends on it */
    }
  }
}
