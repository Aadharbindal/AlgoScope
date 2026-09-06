'use client';

import { ReactNode } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  SkipEndIcon,
} from '@/components/site/Icons';
import { Density } from '@/store/player';

export function IconButton({
  onClick,
  title,
  children,
  disabled,
  primary,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={[
        'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[6px] px-2 font-mono text-[0.72rem] transition-colors',
        primary
          ? 'border border-accent-edge bg-accent-dim px-3 text-accent hover:bg-accent hover:text-on-accent'
          : 'border border-transparent text-muted hover:bg-raised hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="label hidden sm:inline">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex gap-0.5 rounded-[7px] border border-hairline bg-sunk p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={[
              'rounded-[5px] px-2.5 py-1 font-mono text-[0.68rem] transition-colors',
              value === o.value
                ? 'bg-accent-dim text-accent'
                : 'text-muted hover:bg-raised hover:text-ink-2',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ControlsProps {
  step: number;
  total: number;
  playing: boolean;
  speed: number;
  density: Density;
  quizEnabled: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onEvent: (dir: 1 | -1) => void;
  onPlay: (on: boolean) => void;
  onSpeed: (s: number) => void;
  onDensity: (d: Density) => void;
  onQuiz: (on: boolean) => void;
}

export function Controls(p: ControlsProps) {
  const atStart = p.step <= 0;
  const atEnd = p.step >= p.total - 1;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5">
      {/* transport */}
      <div className="flex items-center gap-0.5 rounded-[8px] border border-hairline bg-sunk p-1">
        <IconButton onClick={p.onFirst} title="Restart (Home)" disabled={atStart}>
          <RestartIcon size={14} />
        </IconButton>
        <IconButton
          onClick={() => p.onEvent(-1)}
          title="Previous event (Shift + ←)"
          disabled={atStart}
        >
          <ChevronsLeftIcon size={14} />
        </IconButton>
        <IconButton onClick={p.onPrev} title="Previous step (←)" disabled={atStart}>
          <ArrowLeftIcon size={14} />
        </IconButton>

        <IconButton onClick={p.onNext} title="Next step (→)" disabled={atEnd} primary>
          step
          <ArrowRightIcon size={14} />
        </IconButton>

        <IconButton onClick={() => p.onEvent(1)} title="Next event (Shift + →)" disabled={atEnd}>
          <ChevronsRightIcon size={14} />
        </IconButton>
        <IconButton onClick={p.onLast} title="Jump to end (End)" disabled={atEnd}>
          <SkipEndIcon size={14} />
        </IconButton>

        <span className="mx-0.5 h-4 w-px bg-hairline" />

        <IconButton
          onClick={() => p.onPlay(!p.playing)}
          title={p.playing ? 'Pause (Space)' : 'Autoplay (Space) — stepping manually teaches more'}
          disabled={atEnd && !p.playing}
        >
          {p.playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
        </IconButton>
      </div>

      {p.playing && (
        <Segmented
          label="speed"
          value={String(p.speed)}
          options={[
            { value: '0.5', label: '0.5×' },
            { value: '1', label: '1×' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
          ]}
          onChange={(v) => p.onSpeed(Number(v))}
        />
      )}

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => p.onQuiz(!p.quizEnabled)}
          aria-pressed={p.quizEnabled}
          title="Pause at key steps and ask you to predict what happens next"
          className={[
            'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 font-mono text-[0.68rem] transition-colors',
            p.quizEnabled
              ? 'border-accent-edge bg-accent-dim text-accent'
              : 'border-hairline bg-sunk text-muted hover:text-ink-2',
          ].join(' ')}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${p.quizEnabled ? 'bg-accent' : 'bg-faint'}`}
          />
          predict mode
        </button>

        <Segmented
          label="detail"
          value={p.density}
          options={[
            { value: 'focus' as Density, label: 'focus', title: 'Visualization and one sentence' },
            { value: 'normal' as Density, label: 'normal', title: 'Code, variables, invariant' },
            { value: 'full' as Density, label: 'full', title: 'Everything, including derived values' },
          ]}
          onChange={p.onDensity}
        />
      </div>
    </div>
  );
}
