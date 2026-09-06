'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { setSignalsEnabled, signalsEnabled } from '@/lib/signals/recorder';

/**
 * Says what is being counted, and turns it off.
 *
 * Shown in full rather than buried behind a settings icon, because the thing
 * being collected — where a student struggled — is exactly the thing a student
 * would want to know is being collected. It is also small enough to state
 * completely, which is the argument for keeping it small.
 */

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function SignalNotice() {
  const on = useSyncExternalStore(subscribe, signalsEnabled, () => false);

  const toggle = () => {
    setSignalsEnabled(!on);
    for (const fn of listeners) fn();
  };

  return (
    // Same gutters and max width as the main column, so the notice lines up
    // with the panels above it rather than sitting slightly wider than them.
    // The bottom margin is its own: it is the last thing on the page, and
    // ending flush against the viewport edge reads as the page being cut off.
    <div className="mx-auto mb-10 w-full max-w-[1500px] px-4 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border border-hairline bg-panel px-4 py-3">
        <p className="max-w-3xl text-[0.74rem] leading-relaxed text-faint">
          {on ? (
            <>
              When you leave this page, one summary is sent: which lines you re-read, how long you
              held each, whether you answered a prediction wrongly, and where you stopped. No
              account, no cookie, no IP kept, and no order of events — it is counts per line, which
              is not enough to replay what you did. It goes into the{' '}
              <Link href="/insights" className="text-accent hover:underline">
                map of where readers get stuck
              </Link>
              , which is public.
            </>
          ) : (
            <>
              Nothing is being recorded, and nothing will be sent when you leave. The{' '}
              <Link href="/insights" className="text-accent hover:underline">
                map of where readers get stuck
              </Link>{' '}
              is still readable — it just will not include you.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={on}
          className="ml-auto shrink-0 rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2"
        >
          {on ? 'stop recording' : 'start recording'}
        </button>
      </div>
    </div>
  );
}
