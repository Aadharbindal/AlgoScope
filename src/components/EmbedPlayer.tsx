'use client';

import { useEffect, useMemo, useState } from 'react';
import { CodePanel } from '@/components/player/CodePanel';
import { Narration } from '@/components/player/Panels';
import { Timeline } from '@/components/player/Timeline';
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, PauseIcon, PlayIcon, RestartIcon } from '@/components/site/Icons';
import { Stage } from '@/components/viz/Stage';
import { bySlug } from '@/lib/algorithms';
import { asSet, buildTrace, codeFor, Lang, LANG_LABEL, LANGS, mutatedLines } from '@/lib/algorithms/types';
import { decodeShare, encodeShare } from '@/lib/share/link';
import { resolveLens } from '@/lib/trace/lens';
import { useMinWidth } from '@/lib/ui/useMinWidth';

/**
 * Below this the code column has nowhere to sit beside the stage, so it starts
 * closed rather than stacking underneath and pushing the visualization out of
 * a frame the host page sized. One number drives both the layout and the
 * default, so they cannot disagree.
 */
const TWO_COLUMN = 900;

/**
 * The player, small enough to live inside someone else's article.
 *
 * Deliberately not the workbench with panels hidden. An embed is read by
 * someone who did not come here and will not read instructions: it opens on
 * the step the link names, it steps, and it links out. Everything that needs
 * a decision — inputs, mutations, the bug lab, the code lab — belongs on the
 * full page, and the "open in AlgoScope" link is how you get there.
 *
 * It runs its own trace rather than sharing the workbench's store, so an embed
 * is completely self-contained: no cross-frame state, nothing to collide with
 * a second embed on the same page.
 */
export function EmbedPlayer({ slug, params }: { slug: string; params: Record<string, string> }) {
  const def = bySlug(slug);

  const initial = useMemo(
    () => (def ? decodeShare(def, params) : null),
    [def, params],
  );

  const [step, setStep] = useState(initial?.step ?? 0);
  const [playing, setPlaying] = useState(false);
  const [lang, setLang] = useState<Lang>(initial?.lang ?? 'cpp');
  // Null means "whatever the frame has room for"; a click pins it either way.
  const [codeOverride, setCodeOverride] = useState<boolean | null>(null);
  const roomForCode = useMinWidth(TWO_COLUMN);
  const showCode = codeOverride ?? roomForCode;

  const trace = useMemo(() => {
    if (!def || !initial) return null;
    try {
      return buildTrace(def, initial.input, asSet(initial.mutations));
    } catch {
      return null;
    }
  }, [def, initial]);

  const total = trace?.steps.length ?? 0;
  const at = Math.min(step, Math.max(0, total - 1));

  useEffect(() => {
    if (!playing || total === 0) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= total - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 720);
    return () => window.clearInterval(id);
  }, [playing, total]);

  // Arrow keys work once the frame has focus, and never steal them from the
  // host page before then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStep((s) => Math.min(total - 1, s + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStep((s) => Math.max(0, s - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (!def || !trace || !initial || total === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-ground p-6">
        <p className="font-mono text-xs text-muted">
          {def ? 'this input produces no trace' : `no algorithm called “${slug}”`}
        </p>
      </div>
    );
  }

  const current = trace.steps[at];
  const previous = at > 0 ? trace.steps[at - 1] : undefined;
  const view = resolveLens(def.lens, current, trace.oracle);
  const active = asSet(initial.mutations);
  const fullLink = `/a/${def.slug}?${encodeShare({ ...initial, step: at, lang }, def.fields).toString()}`;

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      {/* -------------------------------- head -------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-accent" aria-hidden />
        <span className="truncate text-[0.82rem] font-semibold tracking-tight">{def.name}</span>
        {initial.mutations.length > 0 && (
          <span className="rounded-[5px] border border-danger-edge px-1.5 py-0.5 font-mono text-[0.6rem] text-danger">
            {initial.mutations.join(' + ')}
          </span>
        )}
        <a
          href={fullLink}
          target="_blank"
          rel="noopener"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:text-accent"
        >
          open in AlgoScope
          <ExternalLinkIcon size={11} />
        </a>
      </div>

      {/* -------------------------------- body -------------------------------- */}
      <div
        className={`flex min-h-0 flex-1 gap-3 overflow-auto p-3 ${
          roomForCode ? 'flex-row' : 'flex-col'
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <Stage step={current} previous={previous} view={view} primary={def.lens.primary} />
        </div>

        {showCode && (
          <aside
            className={`flex shrink-0 flex-col gap-2 ${roomForCode ? 'w-[20rem]' : 'w-full'}`}
          >
            <div className="flex items-center gap-1.5">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={l === lang}
                  className={`rounded-[5px] px-2 py-0.5 font-mono text-[0.64rem] transition-colors ${
                    l === lang ? 'bg-raised text-ink' : 'text-faint hover:text-ink-2'
                  }`}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
              <span className="ml-auto font-mono text-[0.62rem] text-faint">
                line {current.line}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-[8px] border border-hairline bg-panel p-2.5">
              <CodePanel
                code={codeFor(def, active, lang)}
                activeLine={current.line}
                changedLines={mutatedLines(def, active, lang)}
              />
            </div>
          </aside>
        )}
      </div>

      <Narration step={current} total={total} />

      {/* ------------------------------ transport ----------------------------- */}
      <div className="border-t border-hairline px-3 py-2.5">
        <Timeline steps={trace.steps} step={at} onScrub={setStep} showInvariant />
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setStep(0);
              setPlaying(false);
            }}
            disabled={at === 0}
            title="Restart"
            className="rounded-[6px] border border-hairline bg-sunk p-1.5 text-muted transition-colors hover:text-ink-2 disabled:opacity-35"
          >
            <RestartIcon size={13} />
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={at === 0}
            title="Previous step"
            className="rounded-[6px] border border-hairline bg-sunk p-1.5 text-muted transition-colors hover:text-ink-2 disabled:opacity-35"
          >
            <ArrowLeftIcon size={13} />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={at >= total - 1}
            title={playing ? 'Pause' : 'Play'}
            className="rounded-[6px] border border-accent-edge bg-accent-dim p-1.5 text-accent transition-colors hover:bg-accent hover:text-on-accent disabled:opacity-35"
          >
            {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          </button>
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
            disabled={at >= total - 1}
            title="Next step"
            className="rounded-[6px] border border-hairline bg-sunk p-1.5 text-ink-2 transition-colors hover:border-hairline-strong disabled:opacity-35"
          >
            <ArrowRightIcon size={13} />
          </button>

          <button
            type="button"
            onClick={() => setCodeOverride(!showCode)}
            className="ml-auto rounded-[6px] border border-hairline bg-sunk px-2 py-1 font-mono text-[0.62rem] text-muted transition-colors hover:text-ink-2"
          >
            {showCode ? 'hide code' : 'show code'}
          </button>
          <span className="font-mono text-[0.62rem] tabular-nums text-faint">
            {at + 1}/{total}
          </span>
        </div>
      </div>
    </div>
  );
}
