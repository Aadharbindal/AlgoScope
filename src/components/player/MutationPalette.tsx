'use client';

import { CheckIcon, RestartIcon } from '@/components/site/Icons';
import { AlgorithmDef } from '@/lib/algorithms/types';

/**
 * Break it yourself.
 *
 * The Bug Lab hands you a broken version and asks where it went wrong. This is
 * the same machinery pointed the other way: every switch rewrites one decision
 * in the source, the trace re-runs, and the divergence — if there is one —
 * appears immediately. Nothing here is a canned animation of a mistake; it is
 * the real algorithm with a real edit, executed.
 */
export function MutationPalette({
  def,
  active,
  onToggle,
  onReset,
}: {
  def: AlgorithmDef;
  active: string[];
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  if (def.mutations.length === 0) return null;
  const on = new Set(active);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {def.mutations.map((m) => {
          const isOn = on.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id)}
              aria-pressed={isOn}
              title={m.note}
              className={[
                'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 font-mono text-[0.68rem] transition-colors',
                isOn
                  ? 'border-danger-edge bg-danger-dim text-danger'
                  : 'border-hairline bg-sunk text-muted hover:border-hairline-strong hover:text-ink-2',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-flex h-3 w-3 items-center justify-center rounded-[3px] border',
                  isOn ? 'border-danger bg-danger text-ground' : 'border-hairline-strong',
                ].join(' ')}
              >
                {isOn && <CheckIcon size={9} />}
              </span>
              {m.label}
            </button>
          );
        })}

        {active.length > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-accent-edge bg-accent-dim px-2.5 py-1.5 font-mono text-[0.68rem] text-accent transition-colors hover:bg-accent hover:text-on-accent"
          >
            <RestartIcon size={12} />
            back to correct
          </button>
        )}
      </div>

      {active.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-l-2 border-l-danger-edge pl-3">
          {def.mutations
            .filter((m) => on.has(m.id))
            .map((m) => (
              <li key={m.id} className="text-[0.8rem] leading-snug text-ink-2">
                <span className="font-mono text-[0.7rem] text-danger">{m.label}</span> — {m.note}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
