/**
 * The trace contract.
 *
 * Two documents, kept strictly apart:
 *   Trace — what actually happened, emitted by an instrumented run.
 *   Lens  — what it means, a declarative interpretation layered on top.
 *
 * Nothing in the UI may invent a fact that is not in a Trace. The Lens decides
 * how facts are drawn; it never decides what they are.
 */

export type Scalar = number | string | boolean | null;

/* ------------------------------------------------------------------ *
 * Counters — educational operation counts, not hardware measurements.
 * ------------------------------------------------------------------ */

export interface Counters {
  comparisons: number;
  reads: number;
  writes: number;
  swaps: number;
  calls: number;
  iterations: number;
  maxDepth: number;
  /**
   * The most auxiliary cells held at once — the largest the algorithm's own
   * working storage ever got, sampled at every step.
   *
   * Auxiliary means what the term conventionally means: not the input, and not
   * the answer. A sort that rearranges the array it was given allocates
   * nothing; one that merges through a scratch array allocates n. Each
   * algorithm registers what counts by calling `aux`, so the decision is made
   * where it is understood rather than guessed at from the outside.
   */
  auxPeak: number;
}

export const zeroCounters = (): Counters => ({
  comparisons: 0,
  reads: 0,
  writes: 0,
  swaps: 0,
  calls: 0,
  iterations: 0,
  maxDepth: 0,
  auxPeak: 0,
});

/* ------------------------------------------------------------------ *
 * Events — "what kind of thing just happened", used for timeline
 * markers, counters, and narration templates.
 * ------------------------------------------------------------------ */

export type Operand =
  | { kind: 'cell'; container: string; index: number }
  | { kind: 'node'; container: string; id: string }
  | { kind: 'var'; name: string }
  | { kind: 'literal'; value: Scalar };

export type TraceEvent =
  | { type: 'compare'; a: Operand; b: Operand; op: string; result: boolean }
  | { type: 'read'; at: Operand }
  | { type: 'write'; at: Operand; value: Scalar }
  | { type: 'swap'; container: string; i: number; j: number }
  | { type: 'call'; fn: string; label: string }
  | { type: 'return'; fn: string; value: Scalar }
  | { type: 'push'; container: string; value: Scalar }
  | { type: 'pop'; container: string; value: Scalar }
  | { type: 'link'; from: string; to: string | null }
  | { type: 'visit'; container: string; key: string }
  | { type: 'found'; at: Operand }
  | { type: 'fail'; note: string };

export type EventType = TraceEvent['type'];

/* ------------------------------------------------------------------ *
 * Structures — the snapshot of every live data structure at one step.
 * Each step is self-contained so scrubbing backwards is O(1).
 * ------------------------------------------------------------------ */

export interface ArrayStruct {
  kind: 'array';
  id: string;
  values: number[];
  label?: string;
}

export interface ListNode {
  id: string;
  value: number;
  next: string | null;
}

export interface ListStruct {
  kind: 'list';
  id: string;
  nodes: ListNode[];
  /** Named entry points: head, prev, curr, next… drawn as labelled arrows. */
  anchors: Record<string, string | null>;
  label?: string;
}

export interface TreeNode {
  id: string;
  value: number;
  left: string | null;
  right: string | null;
}

/**
 * How far the algorithm has got with one node or cell.
 *
 * One vocabulary across trees, grids and tables, because it is one idea: a
 * search knows about a thing, has it queued, has finished with it, or has
 * decided it lies on the answer. Sharing the names means a reader who has read
 * one of these views can read the others.
 */
export const CELL_STATE = {
  unseen: 0,
  frontier: 1,
  visited: 2,
  path: 3,
} as const;

export type CellState = (typeof CELL_STATE)[keyof typeof CELL_STATE];

export interface TreeStruct {
  kind: 'tree';
  id: string;
  nodes: TreeNode[];
  root: string | null;
  /** Node id → CellState. Absent means every node is unseen. */
  state?: Record<string, number>;
  label?: string;
}

export interface GridStruct {
  kind: 'grid';
  id: string;
  /** The terrain: whatever the reader typed in. `wall` means impassable. */
  cells: number[][];
  /** Per-cell CellState — how far the search has got. */
  state: number[][];
  /**
   * A number to print inside each cell, where there is one to print.
   *
   * Terrain, search progress and computed values are three separate layers of
   * fact and are drawn as three separate things — the character, the colour and
   * the shape. Folding them together (a wall and a visited cell in the same
   * grey) is what makes most maze animations unreadable the moment anything
   * interesting happens.
   */
  overlay?: (number | null)[][];
  /** Cell value meaning "blocked". Defaults to 1. */
  wall?: number;
  /** The cell being looked at right now, if any. */
  cursor?: { r: number; c: number } | null;
  label?: string;
}

export interface TableStruct {
  kind: 'table';
  id: string;
  /** null means "not filled in yet" — a table is read by watching it fill. */
  cells: (number | null)[][];
  rowLabels: string[];
  colLabels: string[];
  /** The cell being computed right now, if any. */
  cursor?: { r: number; c: number } | null;
  /**
   * The already-filled cells this step read to produce the cursor cell.
   *
   * This is the whole point of watching a DP table fill: not that a number
   * appeared, but which earlier answers it was built from. It is a fact of the
   * execution — the algorithm says which cells it read — not an interpretation
   * laid on afterwards.
   */
  from?: { r: number; c: number }[];
  label?: string;
}

export interface GraphNode {
  id: string;
  /** What is drawn inside the circle. Usually the id. */
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Absent on an unweighted graph; drawn on the edge when present. */
  weight?: number;
}

export interface GraphStruct {
  kind: 'graph';
  id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Arrowheads and one-way traversal. Topological sort needs this; BFS does not. */
  directed: boolean;
  /** Node id → CellState, the same vocabulary the grid and tree views use. */
  state?: Record<string, number>;
  /** `from>to` → CellState, for edges the algorithm has committed to. */
  edgeState?: Record<string, number>;
  /** A number to print beside a node: a distance, an in-degree, an order. */
  overlay?: Record<string, number | null>;
  /** The node being looked at right now. */
  cursor?: string | null;
  /**
   * How to place the nodes.
   *
   * Both are deterministic, because a force-directed layout would move the
   * picture between runs and the reader would be looking at a different graph
   * every time they changed the input. `layered` puts each node in the column
   * of its distance from the source, which makes breadth-first search's rings
   * literal; `circle` makes no claim about structure and is the honest choice
   * when there is no source to measure from.
   */
  layout: 'circle' | 'layered';
  label?: string;
}

export interface SeqStruct {
  kind: 'seq';
  id: string;
  values: Scalar[];
  orientation: 'stack' | 'queue' | 'flow';
  label?: string;
}

export type Struct =
  | ArrayStruct
  | ListStruct
  | TreeStruct
  | GridStruct
  | TableStruct
  | GraphStruct
  | SeqStruct;

export type StructKind = Struct['kind'];

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

export interface Frame {
  fn: string;
  /** Human label for the call stack, e.g. "mergeSort(0, 3)". */
  label: string;
  vars: Record<string, Scalar>;
  depth: number;
}

export interface Step {
  i: number;
  /** 1-based line in the algorithm's displayed source. */
  line: number;
  vars: Record<string, Scalar>;
  /**
   * Computed by the instrumentation for invariant checking — never program
   * state, and labelled as such wherever it surfaces.
   */
  derived: Record<string, Scalar>;
  frames: Frame[];
  structs: Record<string, Struct>;
  event?: TraceEvent;
  counters: Counters;
  /** Names of vars (and struct ids) that differ from the previous step. */
  changed: string[];
  narration: string;
  /** Whether the lens invariant held here. undefined = no invariant. */
  invariantHolds?: boolean;
  /**
   * Whether the postcondition held. Set only on the final step, because that
   * is the only step at which there is a result to make a claim about.
   */
  postconditionHolds?: boolean;
  /**
   * Whether the cost claim held. Set only on the final step, because the
   * counters are only final there.
   */
  costHolds?: boolean;
}

export interface Trace {
  algorithm: string;
  variant: string;
  /**
   * Where the trace came from. A reference run is fully instrumented — every
   * comparison and read is counted. A user run is instrumented at statement
   * level only, so the UI must not present its zeroed counters as measurements.
   */
  source?: 'reference' | 'user';
  code: string;
  steps: Step[];
  result: Scalar;
  truncated: boolean;
  /** Values known to the checker but not to the program (e.g. the answer). */
  oracle: Record<string, Scalar>;
}

/* ------------------------------------------------------------------ *
 * Lens — declarative interpretation of a trace.
 *
 * Range endpoints and invariant checks are written as small expression
 * strings evaluated against the step's variables. They are strings rather
 * than closures on purpose: a lens must stay serialisable, because the
 * long-term plan is to infer one for code we have never seen.
 * ------------------------------------------------------------------ */

export type PointerRole =
  | 'window-start'
  | 'window-end'
  | 'probe'
  | 'cursor'
  | 'runner'
  | 'boundary'
  | 'aux';

export interface PointerSpec {
  /** Variable holding the index. */
  var: string;
  /** Structure id the pointer indexes into. */
  on: string;
  role: PointerRole;
  label: string;
  /** Shown in the "why is this here" tooltip. */
  hint?: string;
}

export type RegionKind =
  | 'eliminated'
  | 'active'
  | 'sorted'
  | 'considering'
  | 'found';

export interface RegionSpec {
  on: string;
  kind: RegionKind;
  /** Inclusive endpoints, as expressions over the step's variables. */
  from: string | number;
  to: string | number;
  label?: string;
}

export interface Invariant {
  text: string;
  /** Boolean expression over vars ∪ oracle. */
  check: string;
  /**
   * Guard: the invariant is only meaningful where this holds. Before a loop's
   * variables exist there is nothing to check, and reporting "broken" there
   * would be a lie of a different kind.
   */
  when?: string;
  /** Why this invariant is the point of the algorithm. */
  why: string;
}

/**
 * What the function promises once it has finished.
 *
 * Distinct from the invariant, and the distinction is the point. An invariant
 * is a claim about every step along the way; a postcondition is a claim about
 * the result. A great many real bugs violate only the second — a loop that
 * exits one round early, a traversal that skips a subtree, a sort that stops
 * before it is sorted — and every one of those satisfies a correctly written
 * loop invariant right up until the moment it returns the wrong thing.
 *
 * Checked at the final step, where the answer exists.
 */
export interface Postcondition {
  text: string;
  /** Boolean expression over the same scope the invariant sees. */
  check: string;
  /**
   * When the claim is meaningful at all. Absent means always.
   *
   * The same escape the invariant has, and needed for the same reason: some
   * algorithms have no answer for some inputs. Kadane's and the brute-force
   * maximum subarray read `arr[0]` before they begin, so on an empty array
   * there is nothing they promise — and reporting a correct run as having
   * broken its promise would be a false alarm in the one place this site
   * cannot afford one. A guard is not a way to make a failing claim pass: it
   * says where the claim applies, and where it applies it is checked.
   */
  when?: string;
  why: string;
}

/**
 * What the function promises about the *work* it does, as opposed to the
 * answer it returns.
 *
 * The third kind of claim, and it exists because the first two provably
 * cannot cover everything. An invariant judges the state at each step; a
 * postcondition judges the result. A bug that returns the right answer by a
 * wrong route satisfies both and is caught by neither — reading one element
 * past the end of the array, comparing a pair that was already in order,
 * swapping an element with an equal one, skipping a copy whose elements
 * happened to be in place already. Nothing observable in the state is wrong,
 * because nothing observable in the state *is* wrong. What is wrong is the
 * amount of work, and that is a fact only the counters hold.
 *
 * Checked at the final step, where the counts are final. Written against the
 * same scope as the other two, plus `ops_comparisons`, `ops_reads`,
 * `ops_writes`, `ops_swaps`, `ops_iterations`, `ops_calls`, `ops_maxDepth`
 * and `ops_auxPeak` — prefixed so a claim can never be silently shadowed by
 * a program variable that happens to share a name.
 *
 * A cost claim is a claim, not a benchmark. It says what the algorithm is
 * *allowed* to do, in terms of its own input; it never says how fast anything
 * ran, and it is not the measured complexity, which is recovered by running
 * the thing rather than by asserting about it.
 */
export interface CostClaim {
  text: string;
  /** Boolean expression over the same scope, plus the `ops_` counters. */
  check: string;
  /** When the claim is meaningful at all. Absent means always. */
  when?: string;
  why: string;
}

export interface Lens {
  /** Structure that owns the stage. */
  primary: string;
  pointers: PointerSpec[];
  regions: RegionSpec[];
  invariant?: Invariant;
  postcondition?: Postcondition;
  cost?: CostClaim;
}

/** Algorithm-level definitions live in `lib/algorithms/types.ts`. */
