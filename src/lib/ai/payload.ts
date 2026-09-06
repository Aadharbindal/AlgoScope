import { ResolvedView } from '../trace/lens';
import { Counters, Scalar, Step, Trace, TraceEvent } from '../trace/types';

/**
 * The only thing the model is ever allowed to see.
 *
 * Built deterministically from the trace, on the client, immediately before
 * the request. The model receives facts and is asked to phrase them; it is
 * never asked what happened, because the trace already knows.
 */
export interface ExplainPayload {
  algorithm: string;
  question: string;
  step: number;
  line: number;
  lineSource: string;
  narration: string;
  event: string | null;
  vars: Record<string, Scalar>;
  previousVars: Record<string, Scalar> | null;
  changed: string[];
  arrays: Record<string, number[]>;
  counters: Counters;
  invariant: { text: string; status: 'holds' | 'broken' | 'not-yet-applicable' } | null;
  /** Full listing, so the model can talk about the code around the line. */
  code: string;
}

function describeEvent(e: TraceEvent | undefined): string | null {
  if (!e) return null;
  switch (e.type) {
    case 'compare':
      return `comparison using ${e.op}, result ${e.result}`;
    case 'swap':
      return `swap of positions ${e.i} and ${e.j} in ${e.container}`;
    case 'write':
      return `write of ${e.value}`;
    case 'read':
      return 'read';
    case 'call':
      return `call to ${e.label}`;
    case 'return':
      return `return from ${e.fn}`;
    case 'push':
      return `push of ${e.value} onto ${e.container}`;
    case 'pop':
      return `pop from ${e.container}`;
    case 'link':
      return `pointer rewire: ${e.from} now points to ${e.to ?? 'null'}`;
    case 'found':
      return 'target found';
    case 'fail':
      return `search exhausted (${e.note})`;
    default:
      return e.type;
  }
}

export function buildPayload(
  question: string,
  trace: Trace,
  step: Step,
  previous: Step | undefined,
  view: ResolvedView,
  code: string,
): ExplainPayload {
  const arrays: Record<string, number[]> = {};
  for (const [id, s] of Object.entries(step.structs)) {
    if (s.kind === 'array') arrays[id] = s.values;
  }

  const lines = code.split('\n');

  return {
    algorithm: trace.algorithm,
    question,
    step: step.i,
    line: step.line,
    lineSource: lines[step.line - 1] ?? '',
    narration: step.narration,
    event: describeEvent(step.event),
    vars: step.vars,
    previousVars: previous ? previous.vars : null,
    changed: step.changed,
    arrays,
    counters: step.counters,
    invariant: view.invariant
      ? {
          text: view.invariant.text,
          status: !view.invariant.applicable
            ? 'not-yet-applicable'
            : view.invariant.holds
              ? 'holds'
              : 'broken',
        }
      : null,
    code,
  };
}

/**
 * Every number the payload legitimately contains. The verifier checks the
 * model's output against this set — a figure that is not in here was invented.
 */
export function groundedNumbers(p: ExplainPayload): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.add(String(v));
    if (typeof v === 'string') for (const m of v.match(/-?\d+(\.\d+)?/g) ?? []) out.add(m);
  };

  add(p.step);
  add(p.line);
  for (const v of Object.values(p.vars)) add(v);
  for (const v of Object.values(p.previousVars ?? {})) add(v);
  for (const arr of Object.values(p.arrays)) {
    arr.forEach((v, i) => {
      add(v);
      add(i);
    });
  }
  for (const v of Object.values(p.counters)) add(v);
  add(p.lineSource);
  add(p.narration);
  add(p.code);
  add(p.event ?? '');

  // Small counting words appear in ordinary prose ("the two halves").
  for (const n of ['0', '1', '2', '3']) out.add(n);
  return out;
}
