'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeSelect } from './ThemeSelect';
import { Wordmark } from './Wordmark';

const NAV = [
  { label: 'Visualize', href: '#demo', id: 'demo' },
  { label: 'Algorithms', href: '#algorithms', id: 'algorithms' },
  { label: 'Learn', href: '#how', id: 'how' },
  { label: 'About', href: '#about', id: 'about' },
];

/**
 * Which section the reader is actually looking at.
 *
 * The underline is not decoration — it answers "where am I on this page",
 * which is the only reason a nav on a single-page site earns its space.
 */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const compute = () => {
      // The section crossing the upper third of the viewport is the one being
      // read — not merely the one clipping the edge.
      const line = window.innerHeight * 0.35;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= line && rect.bottom > line) {
          current = id;
          break;
        }
      }
      setActive(current);
    };

    // A handful of rect reads per scroll event is cheaper than the bookkeeping
    // any throttle would add — and unlike rAF it still runs in a hidden tab.
    const first = window.setTimeout(compute, 0);
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [ids]);

  return active;
}

const IDS = NAV.map((n) => n.id);

export function SiteHeader() {
  const active = useActiveSection(IDS);

  return (
    <header className="relative z-20 px-4 pt-4 sm:px-6 sm:pt-5">
      <div
        className="mx-auto flex max-w-[1180px] items-center gap-4 rounded-[18px] border border-hairline-strong px-3.5 py-2.5 sm:gap-6 sm:px-5 sm:py-3"
        style={{
          background: 'linear-gradient(180deg, var(--raised), var(--panel))',
          boxShadow: 'var(--shadow)',
        }}
      >
        <Wordmark tagline />

        <nav className="ml-auto hidden items-center gap-1 sm:gap-2 md:flex">
          {NAV.map((n) => {
            const isActive = active === n.id;
            return (
              <Link
                key={n.label}
                href={n.href}
                aria-current={isActive ? 'true' : undefined}
                className={`group relative px-2.5 py-1.5 text-[0.9rem] transition-colors ${
                  isActive ? 'text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {n.label}
                <span
                  className={`absolute inset-x-2.5 bottom-0 h-[2px] origin-center rounded-full bg-accent transition-transform duration-200 ease-out ${
                    isActive ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto md:ml-0">
          <ThemeSelect />
        </div>
      </div>
    </header>
  );
}
