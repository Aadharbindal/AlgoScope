import { AlgorithmDef, Input, Lang, UserLane } from '../algorithms/types';
import { arr, isArr, isObj, Interpreter, obj, RuntimeError, Scope, stringify, Val } from '../interp/interp';
import { parse } from '../interp/parser';
import { MAX_STEPS } from '../trace/tracer';
import { Counters, Scalar, Step, zeroCounters } from '../trace/types';
import { Bound, chooseSlots, drawsArray, JsNode } from './bind';
import { CompareBy, UserRun } from './run';

/**
 * Run the reader's C, C++ or Java and produce the same Trace everything else
 * on this site consumes.
 *
 * Unlike the JavaScript lane — which can only see statement boundaries, because
 * it is instrumented source handed to the browser's own engine — this lane
 * *is* the engine, so the comparison, read and write counts beside the trace
 * are measured rather than left at zero. It also gives 32-bit `int`
 * arithmetic, which is the only way `(low + high) / 2` can be shown
 * overflowing.
 */

/**
 * A value as the panels can show it.
 *
 * Everything the interpreter can hold reduces to a scalar here, because the
 * variables panel shows one line per name and a nested structure has nowhere to
 * go. A list is printed as the chain it heads, a map as its entries — both
 * truncated, because a variable that renders as four hundred characters is not
 * telling anyone anything.
 */
const clamp = (v: Val): Scalar => {
  if (v === null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  // A tree node has no `next` to follow, so it prints as itself rather than as
  // a one-element chain — which would be indistinguishable from an int.
  if (isObj(v) && !v.fields.has('next')) {
    return `${v.type}(${String(v.fields.get('val') ?? v.fields.get('value') ?? '')})`;
  }
  const text = stringify(v);
  const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  if (isArr(v)) return `[${short}]`;
  return short;
};

function describeStep(changed: string[], vars: Record<string, Scalar>, src: string, ln: number) {
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

/** Thrown to stop the run once the step cap is hit. */
const CAP = '__cap__';

export function runCFamily(
  def: AlgorithmDef,
  source: string,
  lang: Lang,
  input: Input,
  lane: UserLane,
): UserRun {
  const compareBy: CompareBy = lane.compareBy;
  const expectedName = lane.fnName;
  const parsed = parse(source);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, line: parsed.line };
  }

  const steps: Step[] = [];
  const counters: Counters = zeroCounters();
  let truncated = false;

  const inputArr = arr((input.array ?? []).map((n) => n as Val));
  const onStage = drawsArray(lane);
  let prevVars: Record<string, Scalar> = {};

  const interp = new Interpreter(parsed.program, {
    maxSteps: MAX_STEPS,
    observer: {
      compare: () => {
        counters.comparisons++;
      },
      read: () => {
        counters.reads++;
      },
      write: () => {
        counters.writes++;
      },
      call: (depth) => {
        counters.calls++;
        counters.maxDepth = Math.max(counters.maxDepth, depth);
      },
      step: (line, scopes, stack, note) => {
        // Locals of the innermost function frame: walk up until the frame
        // boundary, which is the scope with no parent.
        const vars: Record<string, Scalar> = {};
        const seen = new Set<string>();
        for (let s: Scope | null = scopes[scopes.length - 1]; s; s = s.parent) {
          for (const [k, v] of s.vars) {
            if (seen.has(k)) continue; // an inner shadow wins
            seen.add(k);
            if (isArr(v)) continue; // the array is drawn on the stage
            vars[k] = clamp(v);
          }
        }

        const changed = Object.keys(vars).filter((k) => prevVars[k] !== vars[k]);
        const snapshot = inputArr.v.map((v) => (typeof v === 'number' ? v : 0));
        counters.iterations = steps.length;

        steps.push({
          i: steps.length,
          line,
          vars,
          derived: {},
          frames: (stack.length ? stack : [expectedName]).map((fn, depth) => ({
            fn,
            label: `${fn}(…)`,
            vars: {},
            depth,
          })),
          structs: onStage
            ? { arr: { kind: 'array' as const, id: 'arr', values: snapshot, label: 'arr' } }
            : {},
          counters: { ...counters },
          changed,
          narration: note ?? describeStep(changed, vars, source, line),
        });

        prevVars = vars;
      },
    },
  });

  if (!interp.has(expectedName)) {
    return {
      ok: false,
      message: `No function named "${expectedName}" — that is the one this problem asks for.`,
    };
  }

  const params = interp.paramsOf(expectedName);
  const slots = chooseSlots(params, lane);
  const args = slots.map((slot) =>
    // The array parameter has to be the very object the stage is drawn from —
    // a sort works by leaving the array changed, and handing over a copy would
    // leave the picture untouched while the reader's code did the right thing.
    slot?.as === 'arr'
      ? inputArr
      : toVal(slot ? slot.value(input, lane) : (input.target ?? 0)),
  );
  // A function handed a list and returning null returned an empty list, and an
  // empty list prints as nothing at all — the same as a chain of zero nodes.
  // Printing it as "null" would make the empty case disagree with the reference
  // for a reason that is about spelling rather than about the algorithm.
  const returnsChain = (lane.binds ?? 'array') === 'list';

  let returned: Val = null;
  try {
    returned = interp.callFunction(expectedName, args);
  } catch (err) {
    if (err instanceof RuntimeError) {
      if (err.message === CAP) {
        truncated = true;
      } else {
        return { ok: false, message: err.message, line: err.line };
      }
    } else {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  const raw =
    compareBy === 'array'
      ? inputArr.v.map(stringify).join(',')
      : returned === null && returnsChain
        ? ''
        : stringify(returned);
  const normalised = lane.normalise ? lane.normalise(raw, input, lane) : raw;

  return {
    ok: true,
    returned: clamp(returned),
    normalised,
    trace: {
      algorithm: def.slug,
      variant: `user:${lang}`,
      source: 'user',
      code: source,
      steps,
      result: normalised,
      truncated,
      oracle: {},
    },
  };
}

/**
 * Turn a bound value into something the interpreter holds.
 *
 * Shapes are built once in `bind.ts`, in plain JavaScript, so the two lanes
 * cannot drift apart on what a tree or an adjacency list is. This is the only
 * translation, and it keeps a table of objects already converted — the linked
 * list handed to the cycle detector really does loop back on itself, and
 * walking it without that table would not terminate.
 */
function toVal(b: Bound, made = new Map<object, Val>()): Val {
  if (b === null || typeof b === 'number' || typeof b === 'string') return b;
  const known = made.get(b);
  if (known !== undefined) return known;

  if (Array.isArray(b)) {
    const out = arr([]);
    made.set(b, out);
    for (const item of b) out.v.push(toVal(item, made));
    return out;
  }

  // A node: `val` with either `next`, or `left` and `right`. The field order is
  // the declaration order a constructor would fill, which is what `new Node(5)`
  // means in the reader's own code.
  const node = obj('Node');
  made.set(b, node);
  for (const [k, v] of Object.entries(b as JsNode)) node.fields.set(k, toVal(v, made));
  return node;
}
