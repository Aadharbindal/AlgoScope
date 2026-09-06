import { SessionSignal } from './types';

/**
 * The confusion graph.
 *
 * Turns a pile of session summaries into one claim per line of source: how
 * often readers went back over it, how long they sat on it, how often they
 * mispredicted what it would do, and how often they left there.
 *
 * Three commitments the rest of the code depends on:
 *
 *   1. **Lines, not step indices.** A step index is meaningful only inside one
 *      input. Line 8 of binary search is line 8 for everyone, so that is the
 *      key that lets one reader's difficulty inform another's.
 *   2. **A rate is not shown until it means something.** Under
 *      `MIN_SESSIONS` a line reports `null` for every rate instead of a number
 *      computed from three people. One reader who went to make tea is not
 *      evidence that a line is hard.
 *   3. **The score is never shown alone.** It is a weighted blend, and the
 *      parts that produced it travel with it, so a teacher can see whether a
 *      line scored high because people re-read it or because they left.
 */

/** Below this, every rate for a line is reported as unknown. */
export const MIN_SESSIONS = 5;

/** Re-reads beyond this are treated as the same signal — someone scrubbing. */
const REREAD_CAP = 6;

export interface LineInsight {
  line: number;
  /** Sessions that reached this line at all. */
  sessions: number;
  /** Mean extra visits per session — 0 means everyone read it once. */
  reread: number | null;
  /** Median seconds a session spent on it. */
  dwell: number | null;
  /** Wrong first predictions, over questions asked here. */
  checkpointMiss: number | null;
  /** How many checkpoint answers that rate is based on. */
  checkpointAnswers: number;
  /** Sessions that stopped here without finishing, over sessions reaching it. */
  drop: number | null;
  /** Sessions in which a broken run first parted from the reference here. */
  diverged: number;
  /** 0..1, blended from whichever of the above had data. Null when none did. */
  score: number | null;
}

export interface AlgorithmInsight {
  slug: string;
  sessions: number;
  /** Sessions that reached the last step of their trace. */
  finished: number;
  /** Median seconds per session. */
  medianDuration: number | null;
  /** Which languages readers were in, most-read first. */
  langs: { lang: string; sessions: number }[];
  lines: LineInsight[];
}

export interface ConfusionGraph {
  totalSessions: number;
  algorithms: AlgorithmInsight[];
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Scale a value against the largest seen for this algorithm, 0..1. */
const relative = (v: number, max: number) => (max <= 0 ? 0 : Math.min(1, v / max));

export function buildConfusionGraph(signals: SessionSignal[]): ConfusionGraph {
  const bySlug = new Map<string, SessionSignal[]>();
  for (const s of signals) {
    const list = bySlug.get(s.slug);
    if (list) list.push(s);
    else bySlug.set(s.slug, [s]);
  }

  const algorithms: AlgorithmInsight[] = [];

  for (const [slug, rows] of bySlug) {
    /* -------- per-line accumulation -------- */
    interface Acc {
      sessions: number;
      extraVisits: number;
      dwells: number[];
      cpRight: number;
      cpWrong: number;
      drops: number;
      diverged: number;
    }
    const lines = new Map<number, Acc>();
    const acc = (line: number): Acc => {
      let a = lines.get(line);
      if (!a) {
        a = { sessions: 0, extraVisits: 0, dwells: [], cpRight: 0, cpWrong: 0, drops: 0, diverged: 0 };
        lines.set(line, a);
      }
      return a;
    };

    for (const s of rows) {
      // A line reached through many steps still counts as one session, and a
      // re-read is a return to the *same step* — not a line that simply runs
      // many times. Without that distinction every loop body would rank as the
      // hardest line on the page purely for being a loop body.
      const seen = new Map<number, { extra: number; dwell: number }>();
      for (const v of s.visited) {
        const e = seen.get(v.line) ?? { extra: 0, dwell: 0 };
        e.extra += Math.max(0, v.visits - 1);
        e.dwell += v.dwell;
        seen.set(v.line, e);
      }
      for (const [line, e] of seen) {
        const a = acc(line);
        a.sessions++;
        a.extraVisits += Math.min(REREAD_CAP, e.extra);
        a.dwells.push(e.dwell);
      }
      for (const c of s.checkpoints) {
        const a = acc(c.line);
        if (c.correct) a.cpRight++;
        else a.cpWrong++;
      }
      if (!s.finished && s.lastLine !== null) acc(s.lastLine).drops++;
      if (s.divergedAtLine !== null) acc(s.divergedAtLine).diverged++;
    }

    /* -------- raw components, then a blend scaled within this algorithm -------- */
    const raw = [...lines.entries()].map(([line, a]) => {
      const enough = a.sessions >= MIN_SESSIONS;
      const answers = a.cpRight + a.cpWrong;
      return {
        line,
        a,
        enough,
        answers,
        reread: enough ? a.extraVisits / a.sessions : null,
        dwell: enough ? median(a.dwells) : null,
        miss: answers >= MIN_SESSIONS ? a.cpWrong / answers : null,
        drop: enough ? a.drops / a.sessions : null,
      };
    });

    const maxReread = Math.max(0, ...raw.map((r) => r.reread ?? 0));
    const maxDwell = Math.max(0, ...raw.map((r) => r.dwell ?? 0));

    const lineInsights: LineInsight[] = raw
      .map((r) => {
        // Weighted only over the parts that actually have data, so a line
        // with no checkpoint is not penalised for not having one.
        const parts: { v: number; w: number }[] = [];
        if (r.reread !== null) parts.push({ v: relative(r.reread, maxReread), w: 0.3 });
        if (r.dwell !== null) parts.push({ v: relative(r.dwell, maxDwell), w: 0.2 });
        if (r.miss !== null) parts.push({ v: r.miss, w: 0.35 });
        if (r.drop !== null) parts.push({ v: r.drop, w: 0.15 });
        const w = parts.reduce((t, p) => t + p.w, 0);

        return {
          line: r.line,
          sessions: r.a.sessions,
          reread: r.reread,
          dwell: r.dwell,
          checkpointMiss: r.miss,
          checkpointAnswers: r.answers,
          drop: r.drop,
          diverged: r.a.diverged,
          score: w === 0 ? null : parts.reduce((t, p) => t + p.v * p.w, 0) / w,
        };
      })
      .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.line - y.line);

    const langCounts = new Map<string, number>();
    for (const s of rows) langCounts.set(s.lang, (langCounts.get(s.lang) ?? 0) + 1);

    algorithms.push({
      slug,
      sessions: rows.length,
      finished: rows.filter((s) => s.finished).length,
      medianDuration: median(rows.map((s) => s.duration)),
      langs: [...langCounts.entries()]
        .map(([lang, sessions]) => ({ lang, sessions }))
        .sort((a, b) => b.sessions - a.sessions),
      lines: lineInsights,
    });
  }

  algorithms.sort((a, b) => b.sessions - a.sessions);
  return { totalSessions: signals.length, algorithms };
}
