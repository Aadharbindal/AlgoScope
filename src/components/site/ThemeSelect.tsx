'use client';

import { useSyncExternalStore } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from './Icons';
import { Select } from './Select';

/**
 * Theme control.
 *
 * Three states, not two: an explicit light or dark choice, and "system",
 * which is the absence of a choice. The stylesheet already handles all three
 * — the attribute on <html> is the single source of truth, so this reads it
 * back through an external store rather than keeping a second copy in React.
 */

type Choice = 'light' | 'dark' | 'system';

const KEY = 'algoscope-theme';
const EVENT = 'algoscope-theme-change';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', onChange);
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot(): Choice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode — fall through to system */
  }
  return 'system';
}

/** The palette defaults to dark, so that is what the server renders. */
const getServerSnapshot = (): Choice => 'system';

const ICON = {
  light: <SunIcon size={14} />,
  dark: <MoonIcon size={14} />,
  system: <MonitorIcon size={14} />,
};

export function ThemeSelect() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const apply = (next: string) => {
    const value = next as Choice;
    try {
      if (value === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      /* the choice just does not persist */
    }
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <Select
      value={choice}
      onChange={apply}
      label="Colour theme"
      variant="outlined"
      align="end"
      className="w-[7.6rem] shrink-0"
      options={[
        { value: 'light', label: 'light', icon: ICON.light },
        { value: 'dark', label: 'dark', icon: ICON.dark },
        { value: 'system', label: 'system', icon: ICON.system },
      ]}
    />
  );
}
