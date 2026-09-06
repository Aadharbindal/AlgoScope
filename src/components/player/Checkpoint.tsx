'use client';

import { CheckpointState } from '@/store/player';

/**
 * Predict-then-reveal.
 *
 * The single thing a video cannot do: stop, ask you what happens next, and
 * check your answer. Fires at a handful of steps that carry the concept —
 * never on every step, which would just be friction.
 */
export function Checkpoint({
  checkpoint,
  onAnswer,
  onContinue,
}: {
  checkpoint: CheckpointState;
  onAnswer: (picked: string) => void;
  onContinue: () => void;
}) {
  const picked = checkpoint.picked;
  const correct = picked === checkpoint.answer;

  return (
    <div className="rise rounded-[7px] border border-probe-edge bg-probe-dim/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-probe">
          before you continue
        </span>
        <span className="h-px flex-1 bg-probe-edge/50" />
      </div>

      <p className="mt-2.5 text-[0.95rem] leading-snug text-ink">{checkpoint.question}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {checkpoint.options.map((o) => {
          const isPicked = picked === o;
          const isAnswer = o === checkpoint.answer;
          const state = picked === null ? 'idle' : isAnswer ? 'right' : isPicked ? 'wrong' : 'dim';
          return (
            <button
              key={o}
              type="button"
              disabled={picked !== null}
              onClick={() => onAnswer(o)}
              className={[
                'rounded-[7px] border px-3 py-2 font-mono text-xs transition-colors',
                state === 'idle' &&
                  'border-hairline-strong bg-panel text-ink-2 hover:border-probe hover:text-ink',
                state === 'right' && 'border-accent-edge bg-accent-dim text-accent',
                state === 'wrong' && 'border-danger-edge bg-danger-dim text-danger line-through',
                state === 'dim' && 'border-hairline bg-panel text-faint',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {o}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <div className="rise mt-3.5 border-t border-probe-edge/50 pt-3">
          <p className={`font-mono text-xs ${correct ? 'text-accent' : 'text-danger'}`}>
            {correct ? 'Correct.' : `Not quite — the answer is ${checkpoint.answer}.`}
          </p>
          <p className="mt-1.5 text-[0.85rem] leading-snug text-ink-2">{checkpoint.because}</p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-3 rounded-[7px] border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent"
          >
            continue →
          </button>
        </div>
      )}
    </div>
  );
}
