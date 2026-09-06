'use client';

import { useState } from 'react';
import { AlgorithmDef, Input, InputField } from '@/lib/algorithms/types';

/**
 * The inputs an algorithm declares, in whatever shape it declared them.
 *
 * Driven by `def.fields` rather than hardcoded to an array and a target,
 * because a tree, a maze and a pair of words are all legitimate inputs and none
 * of them survive being typed as a comma-separated list of numbers. A maze in
 * particular is edited by clicking cells — asking someone to enter twenty-four
 * zeroes and ones in the right order is a way of guaranteeing nobody changes
 * the input at all.
 */

const parseArray = (text: string): number[] =>
  text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

interface Props {
  def: AlgorithmDef;
  input: Input;
  onChange: (input: Input) => void;
}

export function InputEditor({ def, input, onChange }: Props) {
  // Drafts are seeded from the committed input. When a preset or edge case
  // replaces the input from outside, the caller changes this component's key
  // and it remounts with the new values — no mirroring effect needed.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const f of def.fields) {
      if (f.kind === 'array') d[f.key] = ((input[f.key] as number[]) ?? []).join(', ');
      else if (f.kind === 'number' || f.kind === 'text') d[f.key] = String(input[f.key] ?? '');
    }
    return d;
  });

  const textual = def.fields.filter((f) => f.kind !== 'grid');
  const grids = def.fields.filter((f) => f.kind === 'grid');

  const commit = (over?: Partial<Input>) => {
    const next: Input = { ...input, ...over };
    for (const f of textual) {
      const raw = draft[f.key] ?? '';
      if (f.kind === 'array') next[f.key] = parseArray(raw);
      else if (f.kind === 'number') next[f.key] = Number(raw) || 0;
      else if (f.kind === 'text') next[f.key] = raw;
    }
    onChange(next);
  };

  const warning = def.validate?.(input) ?? null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className={`flex flex-wrap items-end gap-3 ${textual.length === 0 ? 'hidden' : ''}`}>
        {textual.map((f) => (
          <label key={f.key} className={f.kind === 'array' ? 'min-w-[14rem] flex-1' : 'w-28'}>
            <span className="label mb-1 block" title={f.help}>
              {f.label}
            </span>
            <input
              value={draft[f.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
              }}
              spellCheck={false}
              inputMode={f.kind === 'number' ? 'numeric' : undefined}
              className="w-full rounded-[7px] border border-hairline bg-sunk px-2.5 py-2 font-mono text-xs text-ink outline-none transition-colors focus:border-accent-edge"
              placeholder={f.kind === 'array' ? '2, 5, 8, 12' : undefined}
            />
          </label>
        ))}

        {/* A grid commits on every click, so there is nothing for a button to
            do. Showing one anyway would suggest the edit had not taken. */}
        {textual.length > 0 && (
          <button
            type="button"
            onClick={() => commit()}
            className="h-[2.3rem] rounded-[7px] border border-accent-edge bg-accent-dim px-3 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent"
          >
            run it
          </button>
        )}
      </div>

      {grids.map((f) => (
        <GridField
          key={f.key}
          field={f}
          value={(input[f.key] as number[][]) ?? []}
          onChange={(grid) => commit({ [f.key]: grid })}
        />
      ))}

      {warning && (
        <p className="rounded-[7px] border border-probe-edge bg-probe-dim/50 px-2.5 py-2 text-[0.78rem] leading-snug text-ink-2">
          <span className="font-mono text-[0.65rem] uppercase tracking-wider text-probe">
            precondition
          </span>
          <br />
          {warning}
        </p>
      )}
    </div>
  );
}

/**
 * Click a cell to put a wall there, or take one away.
 *
 * Deliberately the whole editor for this input: no width and height boxes, no
 * randomise button. The interesting question a reader has is "what happens if I
 * block *this*", and every control that is not a cell gets in the way of asking
 * it.
 */
function GridField({
  field,
  value,
  onChange,
}: {
  field: InputField;
  value: number[][];
  onChange: (grid: number[][]) => void;
}) {
  const rows = value.length;
  const cols = value[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return null;

  const toggle = (r: number, c: number) => {
    // The start and the goal are the two cells the problem is defined by, so
    // they are not walls you can place.
    if ((r === 0 && c === 0) || (r === rows - 1 && c === cols - 1)) return;
    onChange(value.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? (v ? 0 : 1) : v))));
  };

  return (
    <div>
      <span className="label mb-1.5 block">{field.label}</span>
      <div className="flex flex-col gap-[3px]">
        {value.map((row, r) => (
          <div key={r} className="flex gap-[3px]">
            {row.map((v, c) => {
              const fixed = (r === 0 && c === 0) || (r === rows - 1 && c === cols - 1);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(r, c)}
                  disabled={fixed}
                  aria-label={`row ${r}, column ${c}, ${v ? 'wall' : 'open'}`}
                  title={fixed ? (r === 0 ? 'start' : 'goal') : v ? 'wall — click to open' : 'open — click to block'}
                  className={[
                    'h-5 w-5 rounded-[3px] border font-mono text-[0.5rem] leading-none transition-colors',
                    fixed
                      ? 'cursor-default border-accent-edge bg-accent-dim text-accent'
                      : v
                        ? 'border-hairline bg-eliminated text-eliminated-ink hover:border-hairline-strong'
                        : 'border-hairline bg-sunk hover:border-accent-edge',
                  ].join(' ')}
                >
                  {fixed ? (r === 0 ? 'S' : 'G') : ''}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {field.help && <p className="mt-1.5 text-[0.72rem] leading-snug text-faint">{field.help}</p>}
    </div>
  );
}

export function EdgeCaseChips({
  def,
  onPick,
  activeLabel,
}: {
  def: AlgorithmDef;
  onPick: (input: Input, label: string) => void;
  activeLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {def.edgeCases.map((ec) => (
        <button
          key={ec.id}
          type="button"
          title={ec.why}
          onClick={() => onPick(ec.input, ec.label)}
          className={[
            'rounded-[7px] border px-2 py-1 font-mono text-[0.65rem] transition-colors',
            activeLabel === ec.label
              ? 'border-accent-edge bg-accent-dim text-accent'
              : 'border-hairline bg-panel text-muted hover:border-hairline-strong hover:text-ink-2',
          ].join(' ')}
        >
          {ec.label}
        </button>
      ))}
    </div>
  );
}
