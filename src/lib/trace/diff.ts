import { Scalar, Step, Struct, Trace } from './types';

/**
 * Divergence Point.
 *
 * Run a suspect implementation and a reference implementation on the same
 * input, then walk both traces until their observable state stops matching.
 * The result is a *location*, computed — not an opinion about the code.
 *
 * Nothing here consults a language model. A model may later phrase the
 * explanation, but it is handed this exact struct and cannot move the answer.
 */

export interface VarDiff {
  key: string;
  reference: Scalar | undefined;
  suspect: Scalar | undefined;
}

export interface CellDiff {
  structId: string;
  index: number;
  reference: number;
  suspect: number;
}

export interface Divergence {
  /** Step index at which the two runs first disagree. */
  index: number;
  /** How many steps they agreed for. */
  agreedFor: number;
  kind: 'state' | 'termination' | 'result';
  reference?: Step;
  suspect?: Step;
  vars: VarDiff[];
  cells: CellDiff[];
  /** Deterministic, template-filled sentence. No model involved. */
  summary: string;
}

function arrayOf(s: Struct | undefined): number[] | null {
  if (!s) return null;
  if (s.kind === 'array') return s.values;
  return null;
}

function varsDiffer(a: Step, b: Step): VarDiff[] {
  const keys = new Set([...Object.keys(a.vars), ...Object.keys(b.vars)]);
  const out: VarDiff[] = [];
  for (const k of keys) {
    if (a.vars[k] !== b.vars[k]) {
      out.push({ key: k, reference: a.vars[k], suspect: b.vars[k] });
    }
  }
  return out;
}

function cellsDiffer(a: Step, b: Step): CellDiff[] {
  const out: CellDiff[] = [];
  const ids = new Set([...Object.keys(a.structs), ...Object.keys(b.structs)]);
  for (const id of ids) {
    const av = arrayOf(a.structs[id]);
    const bv = arrayOf(b.structs[id]);
    if (!av || !bv) continue;
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
      if (av[i] !== bv[i]) {
        out.push({ structId: id, index: i, reference: av[i], suspect: bv[i] });
      }
    }
  }
  return out;
}

function fmt(v: Scalar | undefined): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  return String(v);
}

function summarise(d: Omit<Divergence, 'summary'>): string {
  if (d.kind === 'termination') {
    const who = d.suspect ? 'the reference run' : 'your run';
    const other = d.suspect ? 'yours' : 'the reference';
    return `Both runs agree for ${d.agreedFor} steps, then ${other} stops while ${who} keeps going. The two executions no longer describe the same computation from here.`;
  }
  if (d.kind === 'result') {
    return `Both runs execute identically for all ${d.agreedFor} steps but return different answers. The difference is in what is returned, not in how the work was done.`;
  }
  const parts: string[] = [];
  for (const v of d.vars.slice(0, 3)) {
    parts.push(`${v.key} is ${fmt(v.reference)} in the correct run but ${fmt(v.suspect)} in yours`);
  }
  for (const c of d.cells.slice(0, 3)) {
    parts.push(
      `${c.structId}[${c.index}] is ${c.reference} in the correct run but ${c.suspect} in yours`,
    );
  }
  const tail = parts.length ? parts.join('; ') : 'the two runs take different control paths';
  const more =
    d.vars.length + d.cells.length > 3 ? ` (and ${d.vars.length + d.cells.length - 3} more)` : '';
  return `Identical for ${d.agreedFor} steps. At step ${d.index}, ${tail}${more}.`;
}

/**
 * Compare a suspect trace against a reference trace produced on the same input.
 * Returns null when the two runs are indistinguishable and agree on the result.
 */
export function findDivergence(reference: Trace, suspect: Trace): Divergence | null {
  const n = Math.min(reference.steps.length, suspect.steps.length);

  for (let i = 0; i < n; i++) {
    const a = reference.steps[i];
    const b = suspect.steps[i];
    const vars = varsDiffer(a, b);
    const cells = cellsDiffer(a, b);
    if (vars.length || cells.length) {
      const base = {
        index: i,
        agreedFor: i,
        kind: 'state' as const,
        reference: a,
        suspect: b,
        vars,
        cells,
      };
      return { ...base, summary: summarise(base) };
    }
  }

  if (reference.steps.length !== suspect.steps.length) {
    const base = {
      index: n,
      agreedFor: n,
      kind: 'termination' as const,
      reference: reference.steps[n],
      suspect: suspect.steps[n],
      vars: [],
      cells: [],
    };
    return { ...base, summary: summarise(base) };
  }

  if (reference.result !== suspect.result) {
    const base = {
      index: Math.max(0, n - 1),
      agreedFor: n,
      kind: 'result' as const,
      reference: reference.steps[n - 1],
      suspect: suspect.steps[n - 1],
      vars: [],
      cells: [],
    };
    return { ...base, summary: summarise(base) };
  }

  return null;
}

/** Per-step state signature, used to shade the timeline where runs agree. */
export function agreementMask(reference: Trace, suspect: Trace): boolean[] {
  const len = Math.max(reference.steps.length, suspect.steps.length);
  const mask: boolean[] = new Array(len).fill(false);
  for (let i = 0; i < len; i++) {
    const a = reference.steps[i];
    const b = suspect.steps[i];
    if (!a || !b) {
      mask[i] = false;
      continue;
    }
    mask[i] = varsDiffer(a, b).length === 0 && cellsDiffer(a, b).length === 0;
  }
  return mask;
}
