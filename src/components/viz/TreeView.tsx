'use client';

import { useMemo } from 'react';
import { CELL_STATE, Step, TraceEvent, TreeStruct } from '@/lib/trace/types';

/**
 * A binary tree, laid out so the picture matches the algorithm's own idea of
 * the shape.
 *
 * The x position of a node is its rank in an in-order walk. That is not an
 * aesthetic choice: it is what makes a binary search tree read left-to-right in
 * sorted order, and what makes an in-order traversal visibly sweep across the
 * page. A generic "spread the children evenly" layout draws a tidier picture
 * and hides the one property the reader is here to see.
 *
 * Nothing is drawn that is not in the trace: node values and links come from
 * the struct, the highlight comes from the step's event, and the shading comes
 * from the state the algorithm itself recorded.
 */

interface Props {
  struct: TreeStruct;
  previous?: TreeStruct;
  event?: TraceEvent;
  /** Variables holding node ids, drawn as labels on the nodes they name. */
  vars?: Step['vars'];
}

const NODE_R = 19;
const X_GAP = 52;
const Y_GAP = 74;
const PAD = 30;

interface Placed {
  id: string;
  value: number;
  x: number;
  y: number;
  left: string | null;
  right: string | null;
  state: number;
}

/** The node this step physically touched, if any. */
function touchedNode(event?: TraceEvent): string | null {
  if (!event) return null;
  if (event.type === 'visit') return event.key;
  if (event.type === 'read' || event.type === 'found') {
    return event.at.kind === 'node' ? event.at.id : null;
  }
  if (event.type === 'link') return event.from;
  return null;
}

function layout(struct: TreeStruct): { placed: Placed[]; width: number; height: number } {
  const byId = new Map(struct.nodes.map((n) => [n.id, n]));
  const placed: Placed[] = [];
  const state = struct.state ?? {};

  let column = 0;
  let deepest = 0;

  // Iterative in-order walk: a recursive one would blow the stack on the
  // degenerate trees that are worth showing (a "tree" that is really a list).
  const stack: { id: string; depth: number; phase: 0 | 1 }[] = [];
  if (struct.root) stack.push({ id: struct.root, depth: 0, phase: 0 });
  const guard = struct.nodes.length * 4 + 8;
  let steps = 0;

  while (stack.length > 0 && steps++ < guard) {
    const frame = stack.pop()!;
    const node = byId.get(frame.id);
    if (!node) continue;

    if (frame.phase === 0) {
      stack.push({ ...frame, phase: 1 });
      if (node.left) stack.push({ id: node.left, depth: frame.depth + 1, phase: 0 });
      continue;
    }

    placed.push({
      id: node.id,
      value: node.value,
      x: PAD + column * X_GAP + NODE_R,
      y: PAD + frame.depth * Y_GAP + NODE_R,
      left: node.left,
      right: node.right,
      state: state[node.id] ?? CELL_STATE.unseen,
    });
    column++;
    deepest = Math.max(deepest, frame.depth);

    if (node.right) stack.push({ id: node.right, depth: frame.depth + 1, phase: 0 });
  }

  return {
    placed,
    width: PAD * 2 + Math.max(1, column) * X_GAP,
    height: PAD * 2 + (deepest + 1) * Y_GAP - (Y_GAP - NODE_R * 2),
  };
}

const FILL: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--panel)',
  [CELL_STATE.frontier]: 'var(--probe-dim)',
  [CELL_STATE.visited]: 'var(--accent-dim)',
  [CELL_STATE.path]: 'var(--accent)',
};

const STROKE: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--hairline-strong)',
  [CELL_STATE.frontier]: 'var(--probe-edge)',
  [CELL_STATE.visited]: 'var(--accent-edge)',
  [CELL_STATE.path]: 'var(--accent)',
};

const TEXT: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--muted)',
  [CELL_STATE.frontier]: 'var(--ink)',
  [CELL_STATE.visited]: 'var(--ink)',
  [CELL_STATE.path]: 'var(--on-accent)',
};

export function TreeView({ struct, previous, event, vars }: Props) {
  const { placed, width, height } = useMemo(() => layout(struct), [struct]);
  const here = touchedNode(event);

  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  // Variables that name a node get a label on it — the same idea as the
  // pointer chips over an array, and the only way to see where `node` is.
  const labels = new Map<string, string[]>();
  for (const [name, value] of Object.entries(vars ?? {})) {
    if (typeof value !== 'string' || !pos.has(value)) continue;
    const list = labels.get(value) ?? [];
    list.push(name);
    labels.set(value, list);
  }

  if (placed.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty tree
        </div>
        <p className="max-w-sm text-center text-sm text-muted">
          There is no root. Every traversal returns immediately — which is the base case the
          recursion depends on.
        </p>
      </div>
    );
  }

  const prevState = previous?.state ?? {};

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: width, height: 'auto', margin: '0 auto', display: 'block' }}
        role="img"
        aria-label={`Binary tree of ${placed.length} nodes`}
      >
        {/* edges first, so nodes sit on top of them */}
        {placed.map((p) =>
          [p.left, p.right].map((childId, k) => {
            const c = childId ? pos.get(childId) : undefined;
            if (!c) return null;
            return (
              <line
                key={`${p.id}-${k}`}
                x1={p.x}
                y1={p.y + NODE_R - 2}
                x2={c.x}
                y2={c.y - NODE_R + 2}
                stroke={
                  c.state === CELL_STATE.unseen ? 'var(--hairline-strong)' : 'var(--accent-edge)'
                }
                strokeWidth={1.5}
              />
            );
          }),
        )}

        {placed.map((p) => {
          const isHere = p.id === here;
          const justChanged = (prevState[p.id] ?? CELL_STATE.unseen) !== p.state;
          const names = labels.get(p.id);
          return (
            <g key={p.id}>
              {isHere && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 5}
                  fill="none"
                  stroke="var(--probe)"
                  strokeWidth={1.5}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={NODE_R}
                fill={FILL[p.state] ?? FILL[0]}
                stroke={isHere ? 'var(--probe)' : (STROKE[p.state] ?? STROKE[0])}
                strokeWidth={isHere || justChanged ? 2 : 1.2}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={TEXT[p.state] ?? TEXT[0]}
                style={{ font: '500 13px var(--font-geist-mono), ui-monospace, monospace' }}
              >
                {p.value}
              </text>
              {names && (
                <text
                  x={p.x}
                  y={p.y + NODE_R + 13}
                  textAnchor="middle"
                  fill="var(--probe)"
                  style={{ font: '500 10px var(--font-geist-mono), ui-monospace, monospace' }}
                >
                  {names.join(' ')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** What the shading means, shown only for the states actually present. */
export function TreeLegend({ struct }: { struct: TreeStruct }) {
  const present = new Set(Object.values(struct.state ?? {}));
  const rows: [number, string][] = [
    [CELL_STATE.frontier, 'queued'],
    [CELL_STATE.visited, 'done'],
    [CELL_STATE.path, 'on the answer'],
  ];
  const shown = rows.filter(([s]) => present.has(s));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {shown.map(([s, label]) => (
        <span key={s} className="flex items-center gap-1.5 font-mono text-[0.62rem] text-muted">
          <span
            className="h-2.5 w-2.5 rounded-full border"
            style={{ background: FILL[s], borderColor: STROKE[s] }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
