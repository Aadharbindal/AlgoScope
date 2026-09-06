'use client';

import { useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from '@/components/site/Icons';

type Theme = 'light' | 'dark';

const EVENT = 'algoscope-theme-change';

/**
 * The theme already lives on <html data-theme>, written before paint by the
 * inline script in the root layout. Reading it through an external store keeps
 * the DOM as the single source of truth — no effect, no cascading render, and
 * no flash of the wrong palette.
 */
function subscribe(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function getSnapshot(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The palette defaults to dark, so that is what the server renders. */
const getServerSnapshot = (): Theme => 'dark';

export function ThemeToggle({ pill = false }: { pill?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('algoscope-theme', next);
    } catch {
      /* private mode — the choice just does not persist */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  const Glyph = theme === 'dark' ? MoonIcon : SunIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className={
        pill
          ? 'inline-flex items-center gap-1.5 rounded-full border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-[0.7rem] text-accent transition-colors hover:bg-accent hover:text-on-accent'
          : 'inline-flex items-center gap-1.5 rounded-[3px] border border-hairline bg-panel px-2 py-1 font-mono text-[0.65rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2'
      }
    >
      <Glyph size={pill ? 14 : 12} />
      {theme}
    </button>
  );
}
