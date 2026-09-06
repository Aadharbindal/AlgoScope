'use client';

import { useMemo } from 'react';
import { layerOf } from '@/lib/algorithms/graph';
import { CELL_STATE, GraphStruct } from '@/lib/trace/types';

/**
 * A node-link diagram, laid out deterministically.
 *
 * Deterministic is the whole requirement. A force-directed layout looks better
 * in a screenshot and is useless here: the picture would settle somewhere new
 * on every run, so a reader who changed one edge could not tell what had moved
 * because of their edit and what had moved because the simulation felt like it.
 *
 * Two layouts, and the choice says something. `layered` places a node in the
 * column of its distance from the source, which makes a breadth-first search
 * sweep left to right and makes a topological order read as a line. `circle`
 * asserts no structure at all, and is the right answer when there is no source
 * to measure distance from.
 */

interface Props {
  struct: GraphStruct;
  previous?: GraphStruct;
}

const R = 17;
const PAD = 34;

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
const INK: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--muted)',
  [CELL_STATE.frontier]: 'var(--ink)',
  [CELL_STATE.visited]: 'var(--ink)',
  [CELL_STATE.path]: 'var(--on-accent)',
};

interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
}

function layout(struct: GraphStruct): { placed: Placed[]; width: number; height: number } {
  const n = struct.nodes.length;
  if (n === 0) return { placed: [], width: 100, height: 100 };

  if (struct.layout === 'circle' || n <= 2) {
    // One ring. Starting at the top and going clockwise means node order in the
    // text reads as position in the picture.
    const radius = Math.max(70, Math.min(150, 26 * n));
    const cx = radius + PAD + R;
    const cy = radius + PAD + R;
    const placed = struct.nodes.map((node, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return {
        id: node.id,
        label: node.label,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    });
    return { placed, width: cx * 2, height: cy * 2 };
  }

  const layer = layerOf(struct.nodes, struct.edges, struct.directed);
  const columns = new Map<number, string[]>();
  for (const node of struct.nodes) {
    const l = layer[node.id] ?? 0;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l)!.push(node.id);
  }

  const xs = [...columns.keys()].sort((a, b) => a - b);
  const gapX = 118;
  const gapY = 72;
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));

  const placed: Placed[] = [];
  xs.forEach((l, ci) => {
    const col = columns.get(l)!;
    col.forEach((id, ri) => {
      const node = struct.nodes.find((x) => x.id === id)!;
      placed.push({
        id,
        label: node.label,
        x: PAD + R + ci * gapX,
        // Centre each column against the tallest, so the graph reads as one
        // shape rather than as columns hanging from the top edge.
        y: PAD + R + (ri + (tallest - col.length) / 2) * gapY,
      });
    });
  });

  return {
    placed,
    width: PAD * 2 + R * 2 + (xs.length - 1) * gapX,
    height: PAD * 2 + R * 2 + (tallest - 1) * gapY,
  };
}

export function GraphView({ struct, previous }: Props) {
  const { placed, width, height } = useMemo(() => layout(struct), [struct]);
  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  if (placed.length === 0) {
    return (
      <div className="flex w-full justify-center py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty graph
        </div>
      </div>
    );
  }

  const state = struct.state ?? {};
  const edgeState = struct.edgeState ?? {};
  const overlay = struct.overlay ?? {};
  const prevState = previous?.state ?? {};

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: width, height: 'auto', margin: '0 auto', display: 'block' }}
        role="img"
        aria-label={`Graph of ${placed.length} nodes and ${struct.edges.length} edges`}
      >
        {struct.directed && (
          <defs>
            <marker
              id="gv-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--hairline-strong)" />
            </marker>
            <marker
              id="gv-arrow-live"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
            </marker>
          </defs>
        )}

        {struct.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;

          // Stop the line at the circle's edge so an arrowhead points at the
          // node rather than sitting inside it.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const ux = dx / len;
          const uy = dy / len;
          const gap = R + (struct.directed ? 5 : 2);

          const live = (edgeState[`${e.from}>${e.to}`] ?? CELL_STATE.unseen) !== CELL_STATE.unseen;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;

          return (
            <g key={`${e.from}-${e.to}-${i}`}>
              <line
                x1={a.x + ux * gap}
                y1={a.y + uy * gap}
                x2={b.x - ux * gap}
                y2={b.y - uy * gap}
                stroke={live ? 'var(--accent)' : 'var(--hairline-strong)'}
                strokeWidth={live ? 2 : 1.3}
                markerEnd={struct.directed ? `url(#gv-arrow${live ? '-live' : ''})` : undefined}
              />
              {e.weight !== undefined && (
                <>
                  <circle cx={mx} cy={my} r={9} fill="var(--ground)" />
                  <text
                    x={mx}
                    y={my}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={live ? 'var(--accent)' : 'var(--faint)'}
                    style={{ font: '500 10px var(--font-geist-mono), ui-monospace, monospace' }}
                  >
                    {e.weight}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {placed.map((p) => {
          const s = state[p.id] ?? CELL_STATE.unseen;
          const here = struct.cursor === p.id;
          const changed = (prevState[p.id] ?? CELL_STATE.unseen) !== s;
          const badge = overlay[p.id];

          return (
            <g key={p.id}>
              {here && (
                <circle cx={p.x} cy={p.y} r={R + 5} fill="none" stroke="var(--probe)" strokeWidth={1.5} />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={R}
                fill={FILL[s] ?? FILL[0]}
                stroke={here ? 'var(--probe)' : (STROKE[s] ?? STROKE[0])}
                strokeWidth={here || changed ? 2 : 1.3}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={INK[s] ?? INK[0]}
                style={{ font: '500 12px var(--font-geist-mono), ui-monospace, monospace' }}
              >
                {p.label}
              </text>
              {badge !== undefined && badge !== null && (
                <text
                  x={p.x}
                  y={p.y + R + 12}
                  textAnchor="middle"
                  fill="var(--accent)"
                  style={{ font: '500 10px var(--font-geist-mono), ui-monospace, monospace' }}
                >
                  {badge}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function GraphLegend({ struct }: { struct: GraphStruct }) {
  const present = new Set(Object.values(struct.state ?? {}));
  const rows: [number, string][] = [
    [CELL_STATE.frontier, 'in the frontier'],
    [CELL_STATE.visited, 'settled'],
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
