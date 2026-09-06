'use client';

import { CSSProperties } from 'react';
import { TableStruct } from '@/lib/trace/types';

/**
 * A dynamic-programming table, watched as it fills.
 *
 * The thing worth seeing here is not that a number appeared. It is that the
 * number was assembled out of specific earlier answers — so the cells the step
 * read are outlined and joined to the cell being written. Without that, a DP
 * animation is a spreadsheet filling in for no visible reason, which is exactly
 * the impression most students already have of dynamic programming.
 *
 * `null` means "not computed yet" and is drawn as empty rather than as zero. A
 * zero that has been proven and a zero that is merely the initial value of a JS
 * array are different facts, and showing them the same way is a small lie that
 * makes the fill order impossible to follow.
 */

interface Props {
  struct: TableStruct;
  previous?: TableStruct;
}

export function TableView({ struct, previous }: Props) {
  const rows = struct.cells.length;
  const cols = struct.cells[0]?.length ?? 0;

  if (rows === 0 || cols === 0) {
    return (
      <div className="flex w-full justify-center py-8">
        <div className="rounded border border-dashed border-hairline-strong px-8 py-6 font-mono text-sm text-muted">
          empty table
        </div>
      </div>
    );
  }

  const from = new Set((struct.from ?? []).map((c) => `${c.r},${c.c}`));
  const cursor = struct.cursor;

  // One column width for the labels plus one per data column, so the header row
  // and the body cannot drift out of alignment as values get wider.
  const vars = {
    '--gap': '0.15rem',
    '--cell': `clamp(1.15rem, calc((100cqi - ${cols} * 0.15rem - 2.6rem) / ${cols + 1}), 2.4rem)`,
  } as CSSProperties;

  return (
    <div className="w-full overflow-x-auto" style={{ containerType: 'inline-size' }}>
      <div className="mx-auto w-fit px-1" style={vars}>
        {/* column labels */}
        <div className="mb-[var(--gap)] flex gap-[var(--gap)]">
          <div style={{ width: 'var(--cell)' }} />
          {struct.colLabels.slice(0, cols).map((label, c) => (
            <div
              key={c}
              style={{ width: 'var(--cell)' }}
              className={`text-center font-mono text-[0.6rem] tabular-nums ${
                cursor?.c === c ? 'text-probe' : 'text-faint'
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[var(--gap)]">
          {struct.cells.map((row, r) => (
            <div key={r} className="flex gap-[var(--gap)]">
              <div
                style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                className={`flex items-center justify-center font-mono text-[0.6rem] tabular-nums ${
                  cursor?.r === r ? 'text-probe' : 'text-faint'
                }`}
              >
                {struct.rowLabels[r] ?? r}
              </div>

              {row.slice(0, cols).map((v, c) => {
                const here = cursor?.r === r && cursor?.c === c;
                const source = from.has(`${r},${c}`);
                const filled = v !== null && v !== undefined;
                const changed = previous ? previous.cells[r]?.[c] !== v : false;

                return (
                  <div
                    key={`${c}-${changed ? 'x' : 'o'}`}
                    style={{ width: 'var(--cell)', height: 'var(--cell)' }}
                    className={[
                      'flex items-center justify-center rounded-[3px] border font-mono tabular-nums',
                      'text-[clamp(0.58rem,1.5vw,0.8rem)] transition-colors duration-200',
                      here
                        ? 'border-probe bg-probe-dim text-ink'
                        : source
                          ? 'border-accent-edge bg-accent-dim text-ink'
                          : filled
                            ? 'border-hairline bg-raised text-ink-2'
                            : 'border-dashed border-hairline bg-sunk text-faint',
                      changed && !here ? 'flash' : '',
                    ].join(' ')}
                    title={
                      filled
                        ? `${struct.rowLabels[r] ?? r} × ${struct.colLabels[c] ?? c} = ${v}`
                        : 'not computed yet'
                    }
                  >
                    {filled ? v : ''}
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

export function TableLegend({ struct }: { struct: TableStruct }) {
  const hasFrom = (struct.from ?? []).length > 0;
  const hasEmpty = struct.cells.some((row) => row.some((v) => v === null || v === undefined));

  const rows: [string, string, string][] = [];
  if (struct.cursor) rows.push(['var(--probe-dim)', 'var(--probe)', 'being computed']);
  if (hasFrom) rows.push(['var(--accent-dim)', 'var(--accent-edge)', 'read to compute it']);
  if (hasEmpty) rows.push(['var(--sunk)', 'var(--hairline)', 'not computed yet']);
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
