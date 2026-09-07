import { CSSProperties } from 'react';
import { ResolvedPointer, ResolvedRegion, regionAt } from '@/lib/trace/lens';
import { TextStruct } from '@/lib/trace/types';
import { ARROW_COLOR, centreOf, POINTER_ROW, REGION_CELL, ROLE_COLOR } from './ArrayView';

/**
 * A word, drawn as the row of characters it is.
 *
 * The same visual language as the array view, and deliberately the same: a
 * two-pointer walk over a string and a two-pointer walk over an array are the
 * same picture, and a reader who has learned to read one should not have to
 * learn to read the other. The colours, the pointer arrows and the region
 * shading are imported from there rather than restated, so they cannot drift.
 *
 * What is different is only what a cell holds. Characters are shown as
 * themselves, and a space is drawn as a visible marker rather than as nothing
 * — a blank cell in the middle of a palindrome check is exactly the cell a
 * reader needs to see.
 */
export function TextView({
  struct,
  previous,
  pointers,
  regions,
  step,
}: {
  struct: TextStruct;
  previous?: TextStruct;
  pointers: ResolvedPointer[];
  regions: ResolvedRegion[];
  step: number;
}) {
  const chars = struct.chars;
  const mine = pointers.filter((p) => p.on === struct.id);

  if (chars.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty string
        </div>
        <p className="max-w-sm text-center text-sm text-muted">
          There are no characters. Every index is out of bounds, which is why the empty string is
          worth its own case rather than an assumption.
        </p>
      </div>
    );
  }

  const gridVars = {
    '--gap': '0.25rem',
    '--cell': `clamp(1.3rem, calc((100cqi - ${chars.length - 1} * 0.25rem - 0.6rem) / ${chars.length}), 3.3rem)`,
  } as CSSProperties;

  const inRange = mine.filter((p) => p.index >= 0 && p.index < chars.length);
  const offRange = mine.filter((p) => p.index < 0 || p.index >= chars.length);

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
        <div className="mb-1 flex gap-[var(--gap)]">
          {chars.map((_, i) => (
            <div
              key={i}
              className="text-center font-mono text-[0.6rem] tabular-nums text-faint"
              style={{ width: 'var(--cell)' }}
            >
              {i}
            </div>
          ))}
        </div>

        <div className="flex gap-[var(--gap)]">
          {chars.map((c, i) => {
            const kind = regionAt(regions, struct.id, i);
            const changed = previous ? previous.chars[i] !== c : false;
            return (
              <div
                key={`${i}-${changed ? `c${step}` : 'stable'}`}
                style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                className={[
                  'flex items-center justify-center rounded-[4px] border font-mono',
                  'text-[clamp(0.68rem,1.9vw,1.02rem)] transition-colors duration-200 ease-out',
                  kind ? REGION_CELL[kind] : 'bg-panel border-hairline text-ink-2',
                ].join(' ')}
              >
                {c === ' ' ? <span className="text-faint">␣</span> : c}
              </div>
            );
          })}
        </div>

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

        {offRange.length > 0 && (
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            {offRange.map((p) => (
              <span
                key={p.name}
                className="rounded-[3px] border border-danger-edge bg-danger-dim px-2 py-1 font-mono text-[0.62rem] text-danger"
              >
                {p.label} = {p.index} · outside the string
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
