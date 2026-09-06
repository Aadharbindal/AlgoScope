/**
 * What a reading session tells us about where an algorithm is hard.
 *
 * This is the one thing on this site that compounds. Everyone can film a
 * lecture; nobody else has step-level interaction, because nobody else has
 * step-level interaction to record. Where readers scrub backwards, where they
 * sit still, where a predict-then-reveal checkpoint is answered wrong, and
 * where they give up — those four together locate confusion at the resolution
 * of a *line of code*, which is the resolution a teacher can actually act on.
 *
 * Three rules this file exists to enforce:
 *
 *   1. **No identity.** There is no user id, no cookie, no IP kept, no
 *      referrer, no free text. A session id is random, lives for one page
 *      visit, and is never written down anywhere it could be joined to a
 *      person.
 *   2. **A summary, not a recording.** Nothing here can reconstruct the order
 *      of what someone did or when they did it. It is counts per step, and
 *      that is deliberately not enough to replay a session.
 *   3. **Keyed by line, not by step index.** A step index only means something
 *      within one input; line 8 means the same thing for everyone. Aggregating
 *      by line is what lets one reader's confusion inform another's.
 */

export const SIGNAL_VERSION = 1;

/** Per-step facts, collected while reading and sent once at the end. */
export interface StepSignal {
  /** Step index in this particular trace. */
  i: number;
  /** Source line the step ran — the key that survives a change of input. */
  line: number;
  /** Times this step became the current step. More than one is a re-read. */
  visits: number;
  /** Total time it was on screen, in whole seconds, capped. */
  dwell: number;
}

export interface CheckpointSignal {
  /** The line the question guarded. */
  line: number;
  /** Whether the reader's prediction was right the first time. */
  correct: boolean;
}

export interface SessionSignal {
  v: number;
  /** Random per-visit, never persisted, never joinable to anything. */
  session: string;
  slug: string;
  /** Which language the source was being read in. */
  lang: string;
  /** Mutation ids active, so a broken run is not mixed with a correct one. */
  mutations: string[];
  /** Identifies the input without naming it, so two readers can be compared. */
  input: string;
  /** Total steps in the trace, for turning counts into rates. */
  steps: number;
  /** Only steps the reader actually reached. */
  visited: StepSignal[];
  checkpoints: CheckpointSignal[];
  /** Line where the reference and the mutated run first parted, if shown. */
  divergedAtLine: number | null;
  /** The line the reader was on when they left. */
  lastLine: number | null;
  /** Whether they reached the end of the trace. */
  finished: boolean;
  /** Whole seconds spent on the page, capped — a session, not a timestamp. */
  duration: number;
}

/* ------------------------------------------------------------------ *
 * Validation. Everything here arrives over the network from anyone, so
 * the ingest route trusts precisely nothing.
 * ------------------------------------------------------------------ */

const MAX_STEPS_REPORTED = 400;
const MAX_CHECKPOINTS = 40;
const MAX_DWELL = 3600;

/**
 * Strictly an integer in range — a fractional count is refused rather than
 * rounded. Rounding would be repairing data, and a repaired row is one this
 * log cannot claim actually happened.
 */
const int = (v: unknown, lo: number, hi: number): number | null => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  return v < lo || v > hi ? null : v;
};

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * Returns a clean SessionSignal, or null if anything is off.
 *
 * Deliberately strict and silent: a malformed signal is dropped, never
 * repaired. Repairing it would mean inventing data, and the whole point of
 * this table is that it contains only things that actually happened.
 */
export function parseSignal(raw: unknown, knownSlugs: ReadonlySet<string>): SessionSignal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (int(o.v, SIGNAL_VERSION, SIGNAL_VERSION) === null) return null;

  const session = str(o.session, 40);
  const slug = str(o.slug, 80);
  const lang = str(o.lang, 8);
  const input = str(o.input, 4000);
  if (!session || !slug || !lang || !input) return null;
  if (!knownSlugs.has(slug)) return null;
  if (!/^[a-z]+$/.test(lang)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(session)) return null;

  const steps = int(o.steps, 1, 1_000_000);
  if (steps === null) return null;

  if (!Array.isArray(o.mutations)) return null;
  const mutations: string[] = [];
  for (const m of o.mutations.slice(0, 12)) {
    const id = str(m, 60);
    if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
    mutations.push(id);
  }

  if (!Array.isArray(o.visited) || !Array.isArray(o.checkpoints)) return null;

  const visited: StepSignal[] = [];
  for (const s of o.visited.slice(0, MAX_STEPS_REPORTED)) {
    if (typeof s !== 'object' || s === null) return null;
    const e = s as Record<string, unknown>;
    const i = int(e.i, 0, 1_000_000);
    const line = int(e.line, 1, 100_000);
    const visits = int(e.visits, 1, 100_000);
    const dwell = int(e.dwell, 0, MAX_DWELL);
    if (i === null || line === null || visits === null || dwell === null) return null;
    visited.push({ i, line, visits, dwell });
  }

  const checkpoints: CheckpointSignal[] = [];
  for (const c of o.checkpoints.slice(0, MAX_CHECKPOINTS)) {
    if (typeof c !== 'object' || c === null) return null;
    const e = c as Record<string, unknown>;
    const line = int(e.line, 1, 100_000);
    if (line === null || typeof e.correct !== 'boolean') return null;
    checkpoints.push({ line, correct: e.correct });
  }

  const divergedAtLine = o.divergedAtLine === null ? null : int(o.divergedAtLine, 1, 100_000);
  const lastLine = o.lastLine === null ? null : int(o.lastLine, 1, 100_000);
  if (o.divergedAtLine !== null && divergedAtLine === null) return null;
  if (o.lastLine !== null && lastLine === null) return null;

  const duration = int(o.duration, 0, MAX_DWELL);
  if (duration === null || typeof o.finished !== 'boolean') return null;

  return {
    v: SIGNAL_VERSION,
    session,
    slug,
    lang,
    mutations,
    input,
    steps,
    visited,
    checkpoints,
    divergedAtLine,
    lastLine,
    finished: o.finished,
    duration,
  };
}
