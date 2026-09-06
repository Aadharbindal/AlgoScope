'use client';

import { useEffect, useRef } from 'react';
import { Divergence } from '../trace/diff';
import { Trace } from '../trace/types';
import { CheckpointState } from '@/store/player';
import { SessionRecorder, signalsEnabled } from './recorder';

/**
 * Attach the recorder to a running player.
 *
 * All of it is derived from state the player already holds, so reading is
 * never made slower or more complicated by being measured. The recorder is
 * created once per algorithm and sent once, when the tab is hidden or the page
 * goes away — an abandoned session is precisely the one worth knowing about,
 * and a normal fetch would be cancelled by the unload that makes it
 * interesting.
 */
export function useSessionSignals(args: {
  slug: string;
  lang: string;
  mutations: string[];
  inputKey: string;
  trace: Trace | null;
  step: number;
  checkpoints: CheckpointState[];
  divergence: Divergence | null;
}) {
  const { slug, lang, mutations, inputKey, trace, step, checkpoints, divergence } = args;

  const ref = useRef<SessionRecorder | null>(null);
  const answered = useRef(new Set<number>());

  // One recorder per algorithm; a new slug is a new session.
  useEffect(() => {
    if (!signalsEnabled()) return;
    const rec = new SessionRecorder(slug, lang, mutations, inputKey);
    ref.current = rec;
    answered.current = new Set();

    const send = () => rec.flush();
    const onHide = () => {
      if (document.visibilityState === 'hidden') send();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', send);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', send);
      send();
      ref.current = null;
    };
    // Only the algorithm identity starts a new session; everything else is
    // retargeted in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!trace) return;
    ref.current?.retarget(lang, mutations, inputKey, trace.steps.length);
  }, [lang, mutations, inputKey, trace]);

  useEffect(() => {
    const current = trace?.steps[step];
    if (!current || !trace) return;
    ref.current?.enter(step, current.line, trace.steps.length);
  }, [trace, step]);

  useEffect(() => {
    if (!trace) return;
    for (const c of checkpoints) {
      if (c.picked === null || answered.current.has(c.at)) continue;
      answered.current.add(c.at);
      const line = trace.steps[c.at]?.line;
      if (line !== undefined) ref.current?.checkpoint(line, c.picked === c.answer);
    }
  }, [checkpoints, trace]);

  useEffect(() => {
    if (!divergence || !trace) return;
    const line = trace.steps[divergence.index]?.line;
    if (line !== undefined) ref.current?.diverged(line);
  }, [divergence, trace]);
}
