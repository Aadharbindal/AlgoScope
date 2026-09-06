import Link from 'next/link';
import { PromptMark } from './Icons';

/**
 * The mark: a prompt in a lit badge, then the name, then what the thing is.
 * The badge carries the only glow on the page — it is the one place the
 * instrument looks switched on.
 */
export function Wordmark({
  tagline = false,
  size = 'md',
}: {
  tagline?: boolean;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';

  return (
    <Link
      href="/"
      aria-label="AlgoScope — home"
      className="group flex items-center gap-2.5 sm:gap-3"
    >
      <span
        className={[
          'relative inline-flex shrink-0 items-center justify-center border border-accent-edge bg-sunk text-ink',
          'transition-colors duration-200 group-hover:border-accent',
          sm ? 'h-7 w-7 rounded-[8px]' : 'h-9 w-9 rounded-[11px]',
        ].join(' ')}
        style={{ boxShadow: '0 0 18px -8px var(--accent)' }}
      >
        <PromptMark size={sm ? 14 : 18} />
      </span>

      <span
        className={`font-mono font-semibold tracking-[-0.01em] text-ink ${sm ? 'text-[0.88rem]' : 'text-[1.22rem]'}`}
      >
        algo<span className="text-accent">scope</span>
      </span>

      {tagline && (
        <>
          <span className="hidden h-5 w-px shrink-0 bg-hairline-strong lg:block" />
          <span className="hidden font-mono text-[0.66rem] uppercase tracking-[0.2em] text-faint lg:block">
            a semantic debugger for algorithms
          </span>
        </>
      )}
    </Link>
  );
}
