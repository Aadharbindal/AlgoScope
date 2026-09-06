'use client';

import { CSSProperties } from 'react';
import { ResolvedPointer, ResolvedRegion, regionAt } from '@/lib/trace/lens';
import { ArrayStruct, RegionKind, TraceEvent } from '@/lib/trace/types';

interface Props {
  struct: ArrayStruct;
  previous?: ArrayStruct;
  pointers: ResolvedPointer[];
  regions: ResolvedRegion[];
  event?: TraceEvent;
  step: number;
}

const REGION_CELL: Record<RegionKind, string> = {
  eliminated: 'bg-sunk border-hairline text-eliminated-ink line-through decoration-1',
  active: 'bg-raised border-hairline-strong text-ink',
  sorted: 'bg-accent-dim border-accent-edge text-ink',
  considering: 'bg-raised border-probe text-ink',
  found: 'bg-accent border-accent text-on-accent',
};

const ROLE_COLOR: Record<ResolvedPointer['role'], string> = {
  'window-start': 'text-accent border-accent-edge bg-accent-dim',
  'window-end': 'text-accent border-accent-edge bg-accent-dim',
  probe: 'text-probe border-probe-edge bg-probe-dim',
  cursor: 'text-info border-info bg-info-dim',
  runner: 'text-probe border-probe-edge bg-probe-dim',
  boundary: 'text-muted border-hairline-strong bg-raised',
  aux: 'text-muted border-hairline-strong bg-raised',
};

const ARROW_COLOR: Record<ResolvedPointer['role'], string> = {
  'window-start': 'var(--accent)',
  'window-end': 'var(--accent)',
  probe: 'var(--probe)',
  cursor: 'var(--info)',
  runner: 'var(--probe)',
  boundary: 'var(--muted)',
  aux: 'var(--muted)',
};

/** Indices the current event physically touched, for the probe ring. */
function touched(event?: TraceEvent): number[] {
  if (!event) return [];
  switch (event.type) {
    case 'compare': {
      const out: number[] = [];
      for (const o of [event.a, event.b]) if (o.kind === 'cell') out.push(o.index);
      return out;
    }
    case 'read':
    case 'write':
    case 'found':
      return event.at.kind === 'cell' ? [event.at.index] : [];
    case 'swap':
      return [event.i, event.j];
    default:
      return [];
  }
}

/** Centre of cell i, in the grid's own units. */
const centreOf = (i: number) => `calc((var(--cell) + var(--gap)) * ${i} + var(--cell) / 2)`;

const POINTER_ROW = 21;

export function ArrayView({ struct, previous, pointers, regions, event, step }: Props) {
  const values = struct.values;
  const hot = new Set(touched(event));
  const mine = pointers.filter((p) => p.on === struct.id);

  if (values.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty array
        </div>
        <p className="max-w-sm text-center text-sm text-muted">
          There are no elements. Every index expression is out of bounds — which is exactly why this
          case breaks so much code.
        </p>
      </div>
    );
  }

  // Cells get one uniform width rather than flexing, so a pointer can be
  // placed by arithmetic and slide between indices instead of snapping.
  //
  // That width is derived from the *container*, not the viewport: this view is
  // dropped into panels of very different widths, and a vw-based size overflows
  // the narrow ones. Below the floor the row scrolls rather than becoming
  // unreadable.
  const gridVars = {
    '--gap': '0.25rem',
    '--cell': `clamp(1.3rem, calc((100cqi - ${values.length - 1} * 0.25rem - 0.6rem) / ${values.length}), 3.3rem)`,
  } as CSSProperties;

  const inRange = mine.filter((p) => p.index >= 0 && p.index < values.length);
  const offRange = mine.filter((p) => p.index < 0 || p.index >= values.length);

  // Stack pointers that land on the same index, keeping a stable order.
  const rowOf = new Map<string, number>();
  const used = new Map<number, number>();
  for (const p of inRange) {
    const row = used.get(p.index) ?? 0;
    rowOf.set(p.name, row);
    used.set(p.index, row + 1);
  }
  const stackDepth = Math.max(1, ...[...used.values()]);

  return (
    <div className="w-full overflow-x-auto" style={{ containerType: 'inline-size' }}>
      <div className="mx-auto w-fit px-1" style={gridVars}>
        {/* indices, above the cells so the space below belongs to pointers */}
        <div className="mb-1 flex gap-[var(--gap)]">
          {values.map((_, i) => (
            <div
              key={i}
              className="text-center font-mono text-[0.6rem] tabular-nums text-faint"
              style={{ width: 'var(--cell)' }}
            >
              {i}
            </div>
          ))}
        </div>

        {/* values */}
        <div className="flex gap-[var(--gap)]">
          {values.map((v, i) => {
            const kind = regionAt(regions, struct.id, i);
            const changed = previous ? previous.values[i] !== v : false;
            return (
              <div
                key={`${i}-${changed ? `c${step}` : 'stable'}`}
                style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                className={[
                  'flex items-center justify-center rounded-[4px] border font-mono tabular-nums',
                  'text-[clamp(0.68rem,1.9vw,1.02rem)] transition-colors duration-200 ease-out',
                  kind ? REGION_CELL[kind] : 'bg-panel border-hairline text-ink-2',
                  hot.has(i) ? 'ring-2 ring-probe ring-offset-2 ring-offset-panel' : '',
                  changed ? 'flash' : '',
                ].join(' ')}
                title={`${struct.id}[${i}] = ${v}`}
              >
                {v}
              </div>
            );
          })}
        </div>

        {/* pointers — one persistent node each, so a move animates */}
        {inRange.length > 0 && (
          <div className="relative mt-1.5" style={{ height: stackDepth * POINTER_ROW }}>
            {inRange.map((p) => (
              <div
                key={p.name}
                className="absolute flex -translate-x-1/2 flex-col items-center transition-[left,top] duration-200 ease-out"
                style={{ left: centreOf(p.index), top: (rowOf.get(p.name) ?? 0) * POINTER_ROW }}
                title={p.hint}
              >
                <div
                  className="h-0 w-0 border-x-4 border-b-[5px] border-x-transparent"
                  style={{ borderBottomColor: ARROW_COLOR[p.role] }}
                />
                <span
                  className={`rounded-[3px] border px-1.5 py-0.5 font-mono text-[0.6rem] leading-none ${ROLE_COLOR[p.role]}`}
                >
                  {p.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* pointers that have run off the end still need to be reported */}
        {offRange.length > 0 && (
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            {offRange.map((p) => (
              <span
                key={p.name}
                className="rounded-[3px] border border-danger-edge bg-danger-dim px-2 py-1 font-mono text-[0.62rem] text-danger"
              >
                {p.label} = {p.index} · outside the array
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function RegionLegend({ regions }: { regions: ResolvedRegion[] }) {
  const seen = new Map<RegionKind, string>();
  for (const r of regions) if (r.label && !seen.has(r.kind)) seen.set(r.kind, r.label);
  if (seen.size === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {[...seen.entries()].map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1.5 font-mono text-[0.65rem] text-muted">
          <span className={`inline-block h-2.5 w-2.5 rounded-[2px] border ${REGION_CELL[kind]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
