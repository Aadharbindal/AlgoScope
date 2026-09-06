'use client';

import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChevronIcon } from './Icons';

/**
 * A listbox that belongs to the instrument.
 *
 * A native <select> hands the menu to the operating system, which renders it
 * in its own chrome — square, light, and completely outside the design. For a
 * control sitting inside the hero card that break is the first thing you see.
 */

export interface Option {
  value: string;
  label: string;
  /** Shown before the label, in the trigger and in the list. */
  icon?: ReactNode;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label: string;
  /** Which edge the menu lines up with. */
  align?: 'start' | 'end';
  /** Open upward when the control sits near the bottom of a clipping box. */
  direction?: 'down' | 'up';
  /** `ghost` melts into its surroundings; `outlined` reads as a control. */
  variant?: 'ghost' | 'outlined';
  size?: 'sm' | 'md';
  className?: string;
}

export function Select({
  value,
  options,
  onChange,
  label,
  align = 'start',
  direction = 'down',
  variant = 'ghost',
  size = 'md',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (i: number) => {
    const opt = options[i];
    if (opt) onChange(opt.value);
    setOpen(false);
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
        return;
      }
      if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1));
      else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
      else commit(active);
    }
  };

  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[0.7rem]' : 'px-2.5 py-1.5 text-[0.78rem]';

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((o) => !o);
        }}
        onKeyDown={onButtonKey}
        className={`inline-flex w-full items-center gap-2 rounded-[7px] border font-mono transition-colors ${pad} ${
          open
            ? 'border-accent-edge bg-accent-dim text-accent'
            : variant === 'outlined'
              ? 'border-hairline-strong bg-panel text-ink-2 hover:border-accent-edge hover:text-ink'
              : 'border-transparent bg-transparent text-ink hover:border-hairline hover:bg-panel'
        }`}
      >
        {selected?.icon && <span className="shrink-0 opacity-90">{selected.icon}</span>}
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronIcon
          size={12}
          className={`ml-auto shrink-0 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          id={id}
          role="listbox"
          aria-label={label}
          className={`rise absolute z-30 min-w-full overflow-hidden rounded-[6px] border border-hairline-strong bg-panel py-1 ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${direction === 'up' ? 'bottom-full mb-1.5' : 'mt-1.5'}`}
          style={{ boxShadow: 'var(--shadow)' }}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => commit(i)}
                  onPointerEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[0.74rem] transition-colors ${
                    isSelected
                      ? 'text-accent'
                      : active === i
                        ? 'bg-raised text-ink'
                        : 'text-muted'
                  }`}
                >
                  {o.icon ? (
                    <span className="shrink-0 opacity-90">{o.icon}</span>
                  ) : (
                    <span
                      className={`h-1 w-1 shrink-0 rounded-full ${isSelected ? 'bg-accent' : 'bg-transparent'}`}
                    />
                  )}
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
