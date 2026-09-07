import { evalBool, evalNumber, Scope } from './expr';
import { Lens, PointerRole, RegionKind, Scalar, Step, Trace } from './types';

export interface ResolvedPointer {
  name: string;
  on: string;
  index: number;
  role: PointerRole;
  label: string;
  hint?: string;
}

export interface ResolvedRegion {
  on: string;
  kind: RegionKind;
  from: number;
  to: number;
  label?: string;
}

export interface ResolvedView {
  pointers: ResolvedPointer[];
  regions: ResolvedRegion[];
  invariant?: { text: string; why: string; holds: boolean; applicable: boolean };
  /** Present only on the last step, where there is a result to judge. */
  postcondition?: { text: string; why: string; holds: boolean };
  /** Present only on the last step, where the counters are final. */
  cost?: { text: string; why: string; holds: boolean };
}

/** True when the invariant is in scope at this step and actually holds. */
function checkInvariant(
  inv: { check: string; when?: string },
  scope: Scope,
): { applicable: boolean; holds: boolean } {
  const applicable = inv.when === undefined || evalBool(inv.when, scope);
  if (!applicable) return { applicable: false, holds: true };
  return { applicable: true, holds: evalBool(inv.check, scope) };
}

/**
 * Build the scope an expression sees: program variables, oracle facts, every
 * bound array by id, and `n` for the primary structure's length.
 */
export function scopeFor(step: Step, oracle: Record<string, Scalar>, primary?: string): Scope {
  const scope: Scope = { ...step.vars, ...step.derived, ...oracle };

  // The work done so far, for a cost claim to be written against. Prefixed
  // rather than merged under their plain names: an algorithm is entitled to a
  // variable called `writes`, and a claim that silently read the counter
  // instead would be judging something other than what it says.
  for (const [name, value] of Object.entries(step.counters)) {
    scope[`ops_${name}`] = value;
  }
  for (const [id, st] of Object.entries(step.structs)) {
    if (st.kind === 'array') {
      scope[id] = st.values;
      scope[`${id}_n`] = st.values.length;
    } else if (st.kind === 'seq') {
      scope[`${id}_n`] = st.values.length;
    } else if (st.kind === 'list') {
      scope[`${id}_n`] = st.nodes.length;
    } else if (st.kind === 'text') {
      scope[`${id}_n`] = st.chars.length;
    } else if (st.kind === 'tree') {
      scope[`${id}_n`] = st.nodes.length;
    } else if (st.kind === 'grid') {
      scope[`${id}_n`] = st.cells.length * (st.cells[0]?.length ?? 0);
    } else if (st.kind === 'table') {
      scope[`${id}_n`] = st.cells.length * (st.cells[0]?.length ?? 0);
    } else if (st.kind === 'graph') {
      scope[`${id}_n`] = st.nodes.length;
    }
  }
  // `n` is "the size of the thing on stage", whatever that thing is, so an
  // invariant can be written the same way for a tree as for an array.
  const p = primary ? step.structs[primary] : undefined;
  if (p) {
    if (p.kind === 'array' || p.kind === 'seq') scope.n = p.values.length;
    else if (p.kind === 'list') scope.n = p.nodes.length;
    else if (p.kind === 'text') scope.n = p.chars.length;
    else if (p.kind === 'tree') scope.n = p.nodes.length;
    else if (p.kind === 'grid') scope.n = p.cells.length * (p.cells[0]?.length ?? 0);
    else if (p.kind === 'table') scope.n = p.cells.length * (p.cells[0]?.length ?? 0);
    else if (p.kind === 'graph') scope.n = p.nodes.length;
  }
  return scope;
}

export function resolveLens(
  lens: Lens,
  step: Step,
  oracle: Record<string, Scalar>,
): ResolvedView {
  const scope = scopeFor(step, oracle, lens.primary);

  const pointers: ResolvedPointer[] = [];
  for (const p of lens.pointers) {
    const raw = step.vars[p.var];
    if (raw === undefined || raw === null) continue;
    const index = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(index)) continue;
    pointers.push({
      name: p.var,
      on: p.on,
      index,
      role: p.role,
      label: p.label,
      hint: p.hint,
    });
  }

  const regions: ResolvedRegion[] = [];
  for (const r of lens.regions) {
    const from = evalNumber(r.from, scope);
    const to = evalNumber(r.to, scope);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (to < from) continue;
    regions.push({ on: r.on, kind: r.kind, from: Math.round(from), to: Math.round(to), label: r.label });
  }

  let invariant: ResolvedView['invariant'];
  if (lens.invariant) {
    const { applicable, holds } = checkInvariant(lens.invariant, scope);
    invariant = { text: lens.invariant.text, why: lens.invariant.why, holds, applicable };
  }

  // Only surfaced where the trace recorded a verdict, which is the final step.
  let postcondition: ResolvedView['postcondition'];
  if (lens.postcondition && step.postconditionHolds !== undefined) {
    postcondition = {
      text: lens.postcondition.text,
      why: lens.postcondition.why,
      holds: step.postconditionHolds,
    };
  }

  let cost: ResolvedView['cost'];
  if (lens.cost && step.costHolds !== undefined) {
    cost = { text: lens.cost.text, why: lens.cost.why, holds: step.costHolds };
  }

  return { pointers, regions, invariant, postcondition, cost };
}

/** Stamp each step with whether the lens invariant held there. */
export function annotateInvariant(trace: Trace, lens: Lens): Trace {
  const inv = lens.invariant;
  if (inv) {
    for (const step of trace.steps) {
      const scope = scopeFor(step, trace.oracle, lens.primary);
      const { applicable, holds } = checkInvariant(inv, scope);
      step.invariantHolds = applicable ? holds : undefined;
    }
  }

  // The postcondition is about the result, so it is judged where the result
  // exists — the last step — and nowhere else. Marking it on every step would
  // report the function as broken for the whole run merely because it had not
  // finished yet, which is true of every correct function too.
  const post = lens.postcondition;
  const last = trace.steps[trace.steps.length - 1];
  if (post && last) {
    const scope = scopeFor(last, trace.oracle, lens.primary);
    const applies = post.when === undefined || evalBool(post.when, scope);
    last.postconditionHolds = applies ? evalBool(post.check, scope) : undefined;
  }

  // The cost claim is about the whole run, so like the postcondition it is
  // judged where the run is over — the counters are only final there.
  const cost = lens.cost;
  if (cost && last) {
    const scope = scopeFor(last, trace.oracle, lens.primary);
    const applies = cost.when === undefined || evalBool(cost.when, scope);
    last.costHolds = applies ? evalBool(cost.check, scope) : undefined;
  }

  return trace;
}

export interface LensValidation {
  ok: boolean;
  failedAtStep?: number;
  reason?: string;
}

/**
 * The gate. A lens is only allowed on screen if its invariant holds at every
 * step of a run we already know to be correct. A lens that fails here is a
 * wrong interpretation, and a wrong interpretation is worse than none — we
 * fall back to the plain variable view instead of drawing a confident lie.
 *
 * This is what makes it safe to accept a lens proposed by a model rather than
 * written by us: the proposal is checked against real execution before it
 * renders anything.
 */
export function validateLens(referenceTrace: Trace, lens: Lens): LensValidation {
  const inv = lens.invariant;
  if (inv) {
    for (const step of referenceTrace.steps) {
      const scope = scopeFor(step, referenceTrace.oracle, lens.primary);
      const { applicable, holds } = checkInvariant(inv, scope);
      if (applicable && !holds) {
        return {
          ok: false,
          failedAtStep: step.i,
          reason: `Invariant "${inv.text}" failed at step ${step.i} of a known-correct run.`,
        };
      }
    }
  }

  const post = lens.postcondition;
  const last = referenceTrace.steps[referenceTrace.steps.length - 1];
  if (post && last) {
    const scope = scopeFor(last, referenceTrace.oracle, lens.primary);
    const applies = post.when === undefined || evalBool(post.when, scope);
    if (applies && !evalBool(post.check, scope)) {
      return {
        ok: false,
        failedAtStep: last.i,
        reason: `Postcondition "${post.text}" failed at the end of a known-correct run.`,
      };
    }
  }

  const cost = lens.cost;
  if (cost && last) {
    const scope = scopeFor(last, referenceTrace.oracle, lens.primary);
    const applies = cost.when === undefined || evalBool(cost.when, scope);
    if (applies && !evalBool(cost.check, scope)) {
      return {
        ok: false,
        failedAtStep: last.i,
        reason: `Cost claim "${cost.text}" failed at the end of a known-correct run.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Overlapping regions resolve by declaration order: the last spec that covers
 * an index wins. That puts precedence in the lens author's hands — declare the
 * broad range first and the specific one after it — rather than in a fixed
 * ranking that cannot know which region matters for a given algorithm.
 */
export function regionAt(
  regions: ResolvedRegion[],
  on: string,
  index: number,
): RegionKind | null {
  let best: RegionKind | null = null;
  for (const r of regions) {
    if (r.on !== on) continue;
    if (index < r.from || index > r.to) continue;
    best = r.kind;
  }
  return best;
}
