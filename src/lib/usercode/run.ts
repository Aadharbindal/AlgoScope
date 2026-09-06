import { AlgorithmDef, Input, UserLane } from '../algorithms/types';
import { chooseSlots, drawsArray } from './bind';
import { MAX_STEPS } from '../trace/tracer';
import { Counters, Scalar, Step, Trace, zeroCounters } from '../trace/types';
import { instrument } from './instrument';

/**
 * Run the reader's own JavaScript and produce the same Trace the built-in
 * algorithms produce, so every existing surface — the player, the timeline,
 * the code panel, the counterexample search — works on it unchanged.
 *
 * What runs is what they wrote: the transform only inserts probes, it does not
 * rewrite their logic. Statement-level probing is all we do, which means the
 * fine-grained counters (comparisons, reads) are *not* measured here. They are
 * left at zero and the UI must not show them as if they were.
 *
 * Trust boundary, stated plainly: this executes in the reader's own tab, like
 * a browser console. Code is never taken from a URL and never sent anywhere.
 */

export type UserRun =
  | {
      ok: true;
      trace: Trace;
      /** What the function handed back. */
      returned: Scalar;
      /** The canonical answer string, comparable with the reference's. */
      normalised: string;
    }
  | { ok: false; message: string; line?: number };

const clampScalar = (v: unknown): Scalar => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return `[${v.slice(0, 12).join(', ')}${v.length > 12 ? ', …' : ''}]`;
  // A tree or list node, named by the value it carries. `[object Object]` on
  // every line of the panel would be worse than saying nothing.
  if (typeof v === 'object' && 'val' in (v as Record<string, unknown>)) {
    return `Node(${String((v as Record<string, unknown>).val)})`;
  }
  return String(v);
};

/** How the reader's answer is turned into the same string the reference returns. */
export type CompareBy = 'return' | 'array';

function describe(changed: string[], vars: Record<string, Scalar>, src: string, ln: number): string {
  if (changed.length === 1) {
    const k = changed[0];
    return `${k} is now ${vars[k] === null ? 'null' : String(vars[k])}.`;
  }
  if (changed.length > 1) {
    return changed.map((k) => `${k} = ${vars[k] === null ? 'null' : String(vars[k])}`).join(', ') + '.';
  }
  const text = (src.split(/\r?\n/)[ln - 1] ?? '').trim();
  return text ? `Ran: ${text}` : `Line ${ln}.`;
}

export function runUserCode(
  def: AlgorithmDef,
  source: string,
  input: Input,
  lane: UserLane,
): UserRun {
  const compareBy: CompareBy = lane.compareBy;
  const built = instrument(source, lane.fnName);
  if (!built.ok) return { ok: false, message: built.message, line: built.line };

  const arr = (input.array ?? []).slice();
  const onStage = drawsArray(lane);
  const slots = chooseSlots(built.params, lane);
  const args: unknown[] = slots.map((slot) =>
    // The array itself, not a copy: a sort answers by leaving it changed.
    slot?.as === 'arr' ? arr : slot ? slot.value(input, lane) : (input.target ?? 0),
  );

  let gen: Iterator<[number, Record<string, unknown>]>;
  try {
    const factory = new Function(`${built.code}\nreturn ${built.fnName};`) as () => (
      ...a: unknown[]
    ) => Iterator<[number, Record<string, unknown>]>;
    gen = factory()(...args);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const steps: Step[] = [];
  const counters: Counters = zeroCounters();
  counters.calls = 1;
  counters.maxDepth = 1;

  let prevVars: Record<string, Scalar> = {};
  let prevArr = arr.slice();
  let truncated = false;
  let returned: Scalar = null;
  let rawReturned: unknown = null;

  try {
    for (;;) {
      if (steps.length >= MAX_STEPS) {
        truncated = true;
        break;
      }
      const next = gen.next();
      if (next.done) {
        rawReturned = next.value;
        returned = clampScalar(next.value);
        break;
      }

      const [ln, raw] = next.value;
      const vars: Record<string, Scalar> = {};
      for (const [k, v] of Object.entries(raw)) {
        // The array itself is drawn on the stage; repeating it as a variable
        // would just be noise.
        if (Array.isArray(v)) continue;
        vars[k] = clampScalar(v);
      }

      const changed = Object.keys(vars).filter((k) => prevVars[k] !== vars[k]);
      const snapshot = arr.slice();
      for (let k = 0; k < snapshot.length; k++) {
        if (snapshot[k] !== prevArr[k]) counters.writes++;
      }
      counters.iterations = steps.length;

      steps.push({
        i: steps.length,
        line: ln,
        vars,
        derived: {},
        frames: [{ fn: built.fnName, label: `${built.fnName}(…)`, vars: {}, depth: 0 }],
        structs: onStage
          ? { arr: { kind: 'array' as const, id: 'arr', values: snapshot, label: 'arr' } }
          : {},
        counters: { ...counters },
        changed,
        narration: describe(changed, vars, source, ln),
      });

      prevVars = vars;
      prevArr = snapshot;
    }
  } catch (err) {
    return {
      ok: false,
      message: `Your code threw while running: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // An array answer is joined the way every reference on this site joins one,
  // so a reader returning a list is compared on its contents rather than on
  // JavaScript's idea of how to print an object.
  const raw =
    compareBy === 'array'
      ? arr.join(',')
      : Array.isArray(rawReturned)
        ? rawReturned.join(',')
        : String(returned);
  const normalised = lane.normalise ? lane.normalise(raw, input, lane) : raw;

  return {
    ok: true,
    returned,
    normalised,
    trace: {
      algorithm: def.slug,
      variant: 'user',
      source: 'user',
      code: source,
      steps,
      result: normalised,
      truncated,
      oracle: {},
    },
  };
}
