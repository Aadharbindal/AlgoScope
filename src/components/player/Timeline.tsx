'use client';

import { useCallback, useMemo, useRef } from 'react';
import { EventType, Step } from '@/lib/trace/types';

const EVENT_COLOR: Record<EventType, string> = {
  compare: 'var(--muted)',
  read: 'var(--faint)',
  write: 'var(--probe)',
  swap: 'var(--probe)',
  call: 'var(--info)',
  return: 'var(--info)',
  push: 'var(--accent-edge)',
  pop: 'var(--accent-edge)',
  link: 'var(--probe)',
  visit: 'var(--accent-edge)',
  found: 'var(--accent)',
  fail: 'var(--danger)',
};

export const EVENT_LABEL: Record<EventType, string> = {
  compare: 'comparison',
  read: 'read',
  write: 'write',
  swap: 'swap',
  call: 'call',
  return: 'return',
  push: 'push',
  pop: 'pop',
  link: 'pointer rewire',
  visit: 'visit',
  found: 'found',
  fail: 'exhausted',
};

/** Priority when several steps collapse into one column. */
const RANK: EventType[] = [
  'read',
  'compare',
  'call',
  'return',
  'push',
  'pop',
  'visit',
  'write',
  'swap',
  'link',
  'fail',
  'found',
];

/** How tall a tick stands, by how much the event matters. */
const HEIGHT: Partial<Record<EventType, number>> = {
  found: 1,
  fail: 1,
  swap: 0.72,
  link: 0.72,
  write: 0.62,
  call: 0.5,
  return: 0.5,
  push: 0.45,
  pop: 0.45,
  visit: 0.45,
  compare: 0.46,
  read: 0.34,
};

interface Props {
  steps: Step[];
  step: number;
  onScrub: (step: number) => void;
  /** Step index at which a suspect run stops matching the reference. */
  divergeAt?: number | null;
  /** Steps whose invariant is broken, drawn as a warning rule. */
  showInvariant?: boolean;
}

/**
 * The execution, drawn as a signal.
 *
 * Ticks are a fixed narrow width and sit at their true position, so the track
 * reads as a trace of what happened rather than a bar chart of buckets. Long
 * runs collapse many steps into one column — the loudest event wins it — but a
 * column never grows to fill the space it was given.
 */
const COLUMNS = 260;

export function Timeline({ steps, step, onScrub, divergeAt, showInvariant }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const { slots: ticks, count } = useMemo(() => {
    const n = steps.length;
    const count = Math.min(COLUMNS, n);
    const slots: { type: EventType | null; broken: boolean }[] = Array.from(
      { length: count },
      () => ({ type: null, broken: false }),
    );
    for (let i = 0; i < n; i++) {
      const slot = Math.min(count - 1, Math.floor((i / n) * count));
      const type = steps[i].event?.type ?? null;
      if (type) {
        const cur = slots[slot].type;
        if (!cur || RANK.indexOf(type) > RANK.indexOf(cur)) slots[slot].type = type;
      }
      if (steps[i].invariantHolds === false) slots[slot].broken = true;
    }
    return {
      slots: slots.map((s, i) => ({ ...s, pct: count === 1 ? 50 : (i / (count - 1)) * 100 })),
      count,
    };
  }, [steps]);

  const posToStep = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const t = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.round(Math.max(0, Math.min(1, t)) * (steps.length - 1));
    },
    [steps.length],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onScrub(posToStep(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) onScrub(posToStep(e.clientX));
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const pct = steps.length > 1 ? (step / (steps.length - 1)) * 100 : 0;
  const divergePct =
    divergeAt != null && steps.length > 1 ? (divergeAt / (steps.length - 1)) * 100 : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Execution timeline"
        aria-valuemin={0}
        aria-valuemax={steps.length - 1}
        aria-valuenow={step}
        className="group relative h-12 cursor-pointer touch-none select-none rounded-[7px] border border-hairline bg-sunk px-2 transition-colors hover:border-hairline-strong"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onScrub(Math.max(0, step - 1));
          if (e.key === 'ArrowRight') onScrub(Math.min(steps.length - 1, step + 1));
          if (e.key === 'Home') onScrub(0);
          if (e.key === 'End') onScrub(steps.length - 1);
        }}
      >
        {/* Everything measured sits in one inset layer, so a percentage means
            the same thing for a tick, the playhead and the divergence mark. */}
        <div className="pointer-events-none absolute inset-x-2 inset-y-0">
          <div className="absolute inset-x-0 bottom-2.5 h-px bg-hairline-strong" />
          <div
            className="absolute bottom-2.5 left-0 h-px bg-accent transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />

          {/* the signal */}
          <div className="absolute inset-x-0 bottom-2.5 top-3">
            {ticks.map((t, i) =>
              t.type ? (
                <span
                  key={i}
                  className="absolute bottom-0 -translate-x-1/2 rounded-full"
                  style={{
                    left: `${t.pct}%`,
                    // A dozen steps across a wide track would be invisible at a
                    // hairline; a thousand would merge into a solid bar. Let the
                    // mark take half its column, bounded at both ends.
                    width: `clamp(2px, calc(100% / ${count} * 0.4), 6px)`,
                    height: `${(HEIGHT[t.type] ?? 0.35) * 100}%`,
                    background: EVENT_COLOR[t.type],
                    opacity: t.pct <= pct ? 1 : 0.45,
                  }}
                />
              ) : null,
            )}
          </div>

          {/* where the invariant is broken */}
          {showInvariant && (
            <div className="absolute inset-x-0 top-1.5 h-[3px]">
              {ticks.map((t, i) =>
                t.broken ? (
                  <span
                    key={i}
                    className="absolute h-full w-[3px] -translate-x-1/2 rounded-full bg-danger"
                    style={{ left: `${t.pct}%` }}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* first disagreement with the reference run */}
          {divergePct !== null && (
            <span
              className="absolute inset-y-1.5 w-px -translate-x-1/2 bg-danger"
              style={{ left: `${divergePct}%` }}
            />
          )}

          {/* playhead */}
          <span
            className="absolute inset-y-1.5 w-px -translate-x-1/2 bg-ink transition-[left] duration-150 ease-out"
            style={{ left: `${pct}%` }}
          >
            <span className="absolute -top-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-ink" />
            <span className="absolute -bottom-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-ink" />
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between font-mono text-[0.65rem] text-faint">
        <span>step 0</span>
        <span className="tabular-nums text-muted">
          <span className="text-ink">{step}</span> / {steps.length - 1}
        </span>
        <span>step {steps.length - 1}</span>
      </div>
    </div>
  );
}
