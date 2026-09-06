'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the viewport is at least `px` wide.
 *
 * Read from `matchMedia` rather than a Tailwind breakpoint whenever the same
 * number also has to be known in JavaScript — a layout that stacks at one
 * width while its default state is decided at another produces a panel that is
 * open but has nowhere to go. `useSyncExternalStore` rather than an effect, so
 * the first render already has the right answer on the client and the server
 * gets the narrow one.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
