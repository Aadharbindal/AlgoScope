'use client';

import { CSSProperties } from 'react';
import { CELL_STATE, GridStruct } from '@/lib/trace/types';

/**
 * A 2-D grid: a maze, a board, a picture being flood-filled.
 *
 * The values and the search state are two separate layers of fact, and they are
 * drawn as two separate things — the value is the character in the cell, the
 * search state is the colour behind it. Conflating them (drawing a wall and a
 * visited cell in the same grey) is what makes most maze animations unreadable
 * the moment anything interesting happens.
 *
 * Sizing comes from the container rather than the viewport, because this view
 * is dropped into panels of very different widths.
 */

interface Props {
  struct: GridStruct;
  previous?: GridStruct;
}

const FILL: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--panel)',
  [CELL_STATE.frontier]: 'var(--probe-dim)',
  [CELL_STATE.visited]: 'var(--accent-dim)',
  [CELL_STATE.path]: 'var(--accent)',
};

const EDGE: Record<number, string> = {
  [CELL_STATE.unseen]: 'var(--hairline)',
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

export function GridView({ struct, previous }: Props) {
  const wall = struct.wall ?? 1;
  const rows = struct.cells.length;
  const cols = struct.cells[0]?.length ?? 0;

  if (rows === 0 || cols === 0) {
    return (
      <div className="flex w-full justify-center py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty grid
        </div>
      </div>
    );
  }

  const vars = {
    '--gap': '0.2rem',
    '--cell': `clamp(1.1rem, calc((100cqi - ${cols - 1} * 0.2rem - 0.6rem) / ${cols}), 2.6rem)`,
  } as CSSProperties;

  return (
    <div className="w-full overflow-x-auto" style={{ containerType: 'inline-size' }}>
      <div className="mx-auto w-fit px-1" style={vars}>
        <div className="flex flex-col gap-[var(--gap)]">
          {struct.cells.map((row, r) => (
            <div key={r} className="flex gap-[var(--gap)]">
              {row.map((v, c) => {
                const state = struct.state[r]?.[c] ?? CELL_STATE.unseen;
                const isWall = v === wall;
                const here = struct.cursor?.r === r && struct.cursor?.c === c;
                const shown = struct.overlay ? struct.overlay[r]?.[c] : null;
                const changed = previous
                  ? (previous.state[r]?.[c] ?? 0) !== state ||
                    (previous.overlay ? previous.overlay[r]?.[c] : null) !== shown
                  : false;

                return (
                  <div
                    key={`${c}-${changed ? 'x' : 'o'}`}
                    style={{
                      width: 'var(--cell)',
                      height: 'var(--cell)',
                      background: isWall ? 'var(--eliminated)' : FILL[state],
                      borderColor: here ? 'var(--probe)' : isWall ? 'var(--hairline)' : EDGE[state],
                      color: isWall ? 'var(--eliminated-ink)' : INK[state],
                      borderWidth: here ? 2 : 1,
                    }}
                    className={[
                      'flex items-center justify-center rounded-[3px] border font-mono tabular-nums',
                      'text-[clamp(0.55rem,1.5vw,0.78rem)] transition-colors duration-200',
                      changed ? 'flash' : '',
                    ].join(' ')}
                    title={`row ${r}, column ${c}`}
                  >
                    {isWall ? '' : (shown ?? (v === 0 ? '' : v))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GridLegend({ struct }: { struct: GridStruct }) {
  const wall = struct.wall ?? 1;
  const present = new Set<number>();
  for (const row of struct.state) for (const s of row) present.add(s);
  const hasWall = struct.cells.some((row) => row.some((v) => v === wall));

  const rows: [string, string, string][] = [];
  if (hasWall) rows.push(['var(--eliminated)', 'var(--hairline)', 'wall']);
  if (present.has(CELL_STATE.frontier))
    rows.push([FILL[CELL_STATE.frontier], EDGE[CELL_STATE.frontier], 'in the queue']);
  if (present.has(CELL_STATE.visited))
    rows.push([FILL[CELL_STATE.visited], EDGE[CELL_STATE.visited], 'reached']);
  if (present.has(CELL_STATE.path))
    rows.push([FILL[CELL_STATE.path], EDGE[CELL_STATE.path], 'shortest path']);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {rows.map(([bg, edge, label]) => (
        <span key={label} className="flex items-center gap-1.5 font-mono text-[0.62rem] text-muted">
          <span
            className="h-2.5 w-2.5 rounded-[2px] border"
            style={{ background: bg, borderColor: edge }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
