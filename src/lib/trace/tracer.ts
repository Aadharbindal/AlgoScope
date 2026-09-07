import {
  Counters,
  Frame,
  GraphEdge,
  GraphNode,
  GraphStruct,
  GridStruct,
  ListNode,
  ListStruct,
  Operand,
  Scalar,
  Step,
  Struct,
  TableStruct,
  Trace,
  TraceEvent,
  TreeNode,
  TreeStruct,
  zeroCounters,
} from './types';

/**
 * Cap on recorded steps. A non-terminating bug is a thing students hit
 * constantly, so the trace has to end gracefully and say so rather than
 * hanging the tab.
 */
export const MAX_STEPS = 20_000;

/**
 * Budget for a counting run that is measuring growth.
 *
 * Nothing is recorded, so the only thing this bounds is time — and a legitimate
 * measurement genuinely is long: bubble sort at n = 2048 executes millions of
 * steps and its whole point is to be allowed to. Sharing the player's 20,000
 * step limit with these runs silently truncated every large measurement and
 * turned three different quadratic sorts into O(n log n).
 */
export const COUNT_CAP = 20_000_000;

/**
 * Budget for a counting run that is only asking "what did this return?".
 *
 * The counterexample search runs this hundreds of times, in the browser, on
 * deliberately tiny inputs — so it wants to give up quickly. A mutation that
 * loops forever should be reported as such in a moment, not after twenty
 * million steps.
 */
export const PROBE_CAP = 200_000;

/**
 * How deep the call stack may get before the run is abandoned.
 *
 * Not a performance limit — a memory one. Every recorded step carries a copy of
 * the whole call stack, so a runaway recursion costs depth squared and takes the
 * process down long before the step cap notices. Nothing legitimate here comes
 * close: merge sort on four thousand elements is twelve frames deep.
 */
export const MAX_DEPTH = 2_000;

/**
 * Thrown to stop a counting run that has blown the step cap.
 *
 * A distinct type so callers can tell "this did not terminate" apart from "this
 * threw", which are different facts about an implementation and should not be
 * reported as the same one.
 */
export class StepCapExceeded extends Error {
  constructor() {
    super('step cap exceeded');
    this.name = 'StepCapExceeded';
  }
}

type Narration = string | (() => string);

/**
 * Emits an execution trace as an algorithm runs.
 *
 * Two modes. `trace` records a full self-contained snapshot at every step and
 * is what the player consumes. `count` keeps only the counters, so the same
 * source can be re-run at n = 100_000 to measure growth without allocating a
 * hundred thousand snapshots.
 */
export class Tracer {
  readonly mode: 'trace' | 'count';
  readonly steps: Step[] = [];
  counters: Counters = zeroCounters();
  truncated = false;

  private bindings = new Map<string, () => Struct>();
  /** Steps attempted, recorded or not — the only cap a counting run can see. */
  private executed = 0;
  private auxSources = new Map<string, () => number>();
  private frames: Frame[] = [];
  private prevVars: Record<string, Scalar> = {};
  private oracleVars: Record<string, Scalar> = {};
  private derivedVars: Record<string, Scalar> = {};
  private maxSteps: number;

  constructor(mode: 'trace' | 'count' = 'trace', maxSteps = MAX_STEPS) {
    this.mode = mode;
    this.maxSteps = maxSteps;
  }

  get tracing() {
    return this.mode === 'trace';
  }

  /* ---------------- structure bindings ---------------- */

  /** Bind any structure by giving the tracer a way to snapshot it. */
  bind(id: string, snapshot: () => Struct) {
    this.bindings.set(id, snapshot);
  }

  unbind(id: string) {
    this.bindings.delete(id);
  }

  array(id: string, ref: number[], label?: string) {
    this.bind(id, () => ({ kind: 'array', id, values: ref.slice(), label }));
  }

  /** A word on the stage, one cell per character. */
  text(id: string, ref: () => string, label?: string) {
    this.bind(id, () => ({ kind: 'text' as const, id, chars: [...ref()], label }));
  }

  seq(
    id: string,
    ref: Scalar[],
    orientation: 'stack' | 'queue' | 'flow' = 'flow',
    label?: string,
  ) {
    this.bind(id, () => ({ kind: 'seq', id, values: ref.slice(), orientation, label }));
  }

  list(
    id: string,
    nodes: Map<string, ListNode>,
    anchors: () => Record<string, string | null>,
    label?: string,
  ) {
    this.bind(
      id,
      (): ListStruct => ({
        kind: 'list',
        id,
        nodes: [...nodes.values()].map((n) => ({ ...n })),
        anchors: anchors(),
        label,
      }),
    );
  }

  /**
   * The moving parts of these three are passed as getters rather than values.
   * A snapshot has to read them at the moment the step is taken — a cursor
   * captured once at bind time would be frozen at wherever the algorithm
   * happened to start, and every step would show the same highlight.
   */
  tree(
    id: string,
    nodes: Map<string, TreeNode>,
    root: string | null,
    opts: { state?: () => Record<string, number>; label?: string } = {},
  ) {
    this.bind(
      id,
      (): TreeStruct => ({
        kind: 'tree',
        id,
        nodes: [...nodes.values()].map((n) => ({ ...n })),
        root,
        state: opts.state ? { ...opts.state() } : undefined,
        label: opts.label,
      }),
    );
  }

  grid(
    id: string,
    cells: number[][],
    state: number[][],
    opts: {
      cursor?: () => { r: number; c: number } | null;
      overlay?: () => (number | null)[][];
      wall?: number;
      label?: string;
    } = {},
  ) {
    this.bind(
      id,
      (): GridStruct => ({
        kind: 'grid',
        id,
        cells: cells.map((r) => r.slice()),
        state: state.map((r) => r.slice()),
        overlay: opts.overlay ? opts.overlay().map((r) => r.slice()) : undefined,
        wall: opts.wall,
        cursor: opts.cursor ? opts.cursor() : null,
        label: opts.label,
      }),
    );
  }

  table(
    id: string,
    cells: (number | null)[][],
    rowLabels: string[],
    colLabels: string[],
    opts: {
      cursor?: () => { r: number; c: number } | null;
      from?: () => { r: number; c: number }[];
      label?: string;
    } = {},
  ) {
    this.bind(
      id,
      (): TableStruct => ({
        kind: 'table',
        id,
        cells: cells.map((r) => r.slice()),
        rowLabels: rowLabels.slice(),
        colLabels: colLabels.slice(),
        cursor: opts.cursor ? opts.cursor() : null,
        from: opts.from ? opts.from().map((c) => ({ ...c })) : undefined,
        label: opts.label,
      }),
    );
  }

  graph(
    id: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    opts: {
      directed?: boolean;
      layout?: 'circle' | 'layered';
      state?: () => Record<string, number>;
      edgeState?: () => Record<string, number>;
      overlay?: () => Record<string, number | null>;
      cursor?: () => string | null;
      label?: string;
    } = {},
  ) {
    this.bind(
      id,
      (): GraphStruct => ({
        kind: 'graph',
        id,
        nodes: nodes.map((n) => ({ ...n })),
        edges: edges.map((e) => ({ ...e })),
        directed: opts.directed ?? false,
        layout: opts.layout ?? 'circle',
        state: opts.state ? { ...opts.state() } : undefined,
        edgeState: opts.edgeState ? { ...opts.edgeState() } : undefined,
        overlay: opts.overlay ? { ...opts.overlay() } : undefined,
        cursor: opts.cursor ? opts.cursor() : null,
        label: opts.label,
      }),
    );
  }

  /* ---------------- auxiliary space ---------------- */

  /**
   * Register a structure that counts as auxiliary space.
   *
   * Sampled at every step, and the largest total seen is what the complexity
   * page reports — so a scratch array that is allocated and released still
   * shows its peak, and one that grows and shrinks is measured at its widest
   * rather than at the end.
   *
   * What to register is a judgement the algorithm has to make and the tracer
   * cannot: the input is never auxiliary, the returned answer is not either,
   * and a queue or a memo table is. Registering the output would turn every
   * traversal into O(n) space and quietly make the number meaningless.
   */
  aux(id: string, size: () => number) {
    this.auxSources.set(id, size);
  }

  private sampleSpace() {
    if (this.auxSources.size === 0) return;
    let total = 0;
    for (const size of this.auxSources.values()) total += Math.max(0, size());
    if (total > this.counters.auxPeak) this.counters.auxPeak = total;
  }

  /* ---------------- call stack ---------------- */

  enter(fn: string, label: string, vars: Record<string, Scalar> = {}) {
    this.counters.calls++;
    this.frames.push({ fn, label, vars, depth: this.frames.length });
    this.counters.maxDepth = Math.max(this.counters.maxDepth, this.frames.length);
    if (this.frames.length > MAX_DEPTH) {
      this.truncated = true;
      throw new StepCapExceeded();
    }
  }

  exit() {
    this.frames.pop();
  }

  get depth() {
    return this.frames.length;
  }

  /* ---------------- oracle ---------------- */

  /**
   * Facts the checker knows but the program does not — the index the target
   * actually sits at, say. Used only by invariant checks, and labelled as
   * such in the UI so it is never mistaken for program state.
   */
  oracle(vars: Record<string, Scalar>) {
    Object.assign(this.oracleVars, vars);
  }

  /**
   * Publish values the instrumentation computed to make an invariant
   * checkable — "the largest value still unsorted", say. Kept out of the
   * variables panel because they are not variables the program has.
   */
  derive(vars: Record<string, Scalar>) {
    Object.assign(this.derivedVars, vars);
  }

  /* ---------------- counting ---------------- */

  tick() {
    this.counters.iterations++;
  }

  private applyCounters(event?: TraceEvent) {
    if (!event) return;
    switch (event.type) {
      case 'compare':
        this.counters.comparisons++;
        break;
      case 'read':
        this.counters.reads++;
        break;
      case 'write':
        this.counters.writes++;
        break;
      case 'swap':
        this.counters.swaps++;
        this.counters.reads += 2;
        this.counters.writes += 2;
        break;
      // Rewiring a pointer is a write to a field, and counts as one.
      case 'link':
        this.counters.writes++;
        break;
      default:
        break;
    }
  }

  /* ---------------- the step ---------------- */

  step(line: number, vars: Record<string, Scalar>, narration: Narration, event?: TraceEvent) {
    this.applyCounters(event);
    // Sampled before the early return, so counting runs measure space too.
    this.sampleSpace();
    this.executed++;

    // The cap has to stop the algorithm, not merely stop recording it.
    //
    // Returning quietly past the limit left a non-terminating run spinning
    // forever inside its own loop while the tracer sat there declining to
    // write anything down — the trace was capped, the process was not. By this
    // point `steps` already holds every step that will ever be shown, so
    // throwing costs nothing and is the only thing that actually ends the run.
    if (this.executed > this.maxSteps) {
      this.truncated = true;
      throw new StepCapExceeded();
    }

    if (!this.tracing) return;

    const structs: Record<string, Struct> = {};
    for (const [id, snap] of this.bindings) structs[id] = snap();

    const changed: string[] = [];
    for (const k of Object.keys(vars)) {
      if (this.prevVars[k] !== vars[k]) changed.push(k);
    }

    this.steps.push({
      i: this.steps.length,
      line,
      vars: { ...vars },
      derived: { ...this.derivedVars },
      frames: this.frames.map((f) => ({ ...f, vars: { ...f.vars } })),
      structs,
      event,
      counters: { ...this.counters },
      changed,
      narration: typeof narration === 'function' ? narration() : narration,
    });

    this.prevVars = { ...vars };
  }

  finish(algorithm: string, variant: string, code: string, result: Scalar): Trace {
    return {
      algorithm,
      variant,
      code,
      steps: this.steps,
      result,
      truncated: this.truncated,
      oracle: { ...this.oracleVars },
    };
  }
}

/* ------------------------------------------------------------------ *
 * Event builders — terse enough that algorithm source stays readable.
 * ------------------------------------------------------------------ */

export const ev = {
  cmp(a: Operand, op: string, b: Operand, result: boolean): TraceEvent {
    return { type: 'compare', a, op, b, result };
  },
  read(container: string, index: number): TraceEvent {
    return { type: 'read', at: { kind: 'cell', container, index } };
  },
  write(container: string, index: number, value: Scalar): TraceEvent {
    return { type: 'write', at: { kind: 'cell', container, index }, value };
  },
  readNode(container: string, id: string): TraceEvent {
    return { type: 'read', at: { kind: 'node', container, id } };
  },
  swap(container: string, i: number, j: number): TraceEvent {
    return { type: 'swap', container, i, j };
  },
  call(fn: string, label: string): TraceEvent {
    return { type: 'call', fn, label };
  },
  ret(fn: string, value: Scalar): TraceEvent {
    return { type: 'return', fn, value };
  },
  push(container: string, value: Scalar): TraceEvent {
    return { type: 'push', container, value };
  },
  pop(container: string, value: Scalar): TraceEvent {
    return { type: 'pop', container, value };
  },
  link(from: string, to: string | null): TraceEvent {
    return { type: 'link', from, to };
  },
  visit(container: string, key: string): TraceEvent {
    return { type: 'visit', container, key };
  },
  found(container: string, index: number): TraceEvent {
    return { type: 'found', at: { kind: 'cell', container, index } };
  },
  fail(note: string): TraceEvent {
    return { type: 'fail', note };
  },
};

/** Operand shorthands. */
export const cell = (container: string, index: number) =>
  ({ kind: 'cell', container, index }) as const;
export const vr = (name: string) => ({ kind: 'var', name }) as const;
export const lit = (value: Scalar) => ({ kind: 'literal', value }) as const;
