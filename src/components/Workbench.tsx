'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GrowthChart } from '@/components/complexity/GrowthChart';
import { SpacePanel } from '@/components/complexity/SpacePanel';
import { AskWhy } from '@/components/player/AskWhy';
import { Checkpoint } from '@/components/player/Checkpoint';
import { CodePanel } from '@/components/player/CodePanel';
import { Controls } from '@/components/player/Controls';
import { DivergencePanel } from '@/components/player/DivergencePanel';
import { EdgeCaseChips, InputEditor } from '@/components/player/InputEditor';
import { MutationPalette } from '@/components/player/MutationPalette';
import { CodeLab } from '@/components/usercode/CodeLab';
import {
  CountersPanel,
  InvariantPanel,
  Narration,
  Panel,
  VariablesPanel,
} from '@/components/player/Panels';
import { Timeline } from '@/components/player/Timeline';
import { CallStackView, Stage } from '@/components/viz/Stage';
import { ArrowRightIcon, LadderIcon } from '@/components/site/Icons';
import { ThemeSelect } from '@/components/site/ThemeSelect';
import Link from 'next/link';
import { ShareMenu } from '@/components/site/ShareMenu';
import { SignalNotice } from '@/components/site/SignalNotice';
import { Wordmark } from '@/components/site/Wordmark';
import {
  AlgorithmDef,
  codeFor,
  Input,
  Lang,
  LANG_LABEL,
  LANGS,
  mutatedLines,
} from '@/lib/algorithms/types';
import { bySlug, CATEGORY_LABEL } from '@/lib/algorithms';
import { Counterexample, findCounterexample } from '@/lib/trace/counterexample';
import { Divergence } from '@/lib/trace/diff';
import { decodeShare, encodeShare, inputKey } from '@/lib/share/link';
import { useSessionSignals } from '@/lib/signals/useSignals';
import { resolveLens } from '@/lib/trace/lens';
import { laddersFor } from '@/lib/ladders';
import { useMinWidth } from '@/lib/ui/useMinWidth';
import { CeOutcome, matchVariant, usePlayer } from '@/store/player';

type Tab = 'understand' | 'visualize' | 'buglab' | 'yourcode' | 'complexity';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'understand', label: 'Understand', hint: 'What problem is this solving?' },
  { id: 'visualize', label: 'Visualize', hint: 'Step through a real execution' },
  { id: 'buglab', label: 'Bug Lab', hint: 'Find where a broken version goes wrong' },
  { id: 'yourcode', label: 'Your code', hint: 'Run your own implementation and have it checked' },
  { id: 'complexity', label: 'Complexity', hint: 'Measured, not asserted' },
];

/** Rail width in px: comfortable default, and the range a drag may reach. */
const DEFAULT_RAIL = 560;
const MIN_RAIL = 380;
const MAX_RAIL = 860;

/**
 * Algorithm definitions carry functions (`run`, `validate`, checkpoint
 * closures), so they cannot cross the server→client boundary. The page hands
 * over a slug and the lookup happens here.
 */
export function Workbench({ slug }: { slug: string }) {
  const def = bySlug(slug);
  if (!def) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="font-mono text-xs text-muted">no algorithm called “{slug}”</p>
      </div>
    );
  }
  return <Instrument def={def} />;
}

function Instrument({ def }: { def: AlgorithmDef }) {
  // The tab is derived, not pushed to: with a variant loaded the Bug Lab is
  // the relevant surface, and an explicit click overrides that from then on.
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [presetLabel, setPresetLabel] = useState<string | undefined>();

  const trace = usePlayer((s) => s.trace);
  const divergence = usePlayer((s) => s.divergence);
  const step = usePlayer((s) => s.step);
  const input = usePlayer((s) => s.input);
  const mutations = usePlayer((s) => s.mutations);
  const playing = usePlayer((s) => s.playing);
  const speed = usePlayer((s) => s.speed);
  const density = usePlayer((s) => s.density);
  const quizEnabled = usePlayer((s) => s.quizEnabled);
  const checkpoints = usePlayer((s) => s.checkpoints);
  const blocking = usePlayer((s) => s.blocking);
  const ce = usePlayer((s) => s.ce);
  const loadedSlug = usePlayer((s) => s.def?.slug);
  const lang = usePlayer((s) => s.lang);

  // Reading is measured, never steered: nothing below changes what is shown.
  useSessionSignals({
    slug: def.slug,
    lang,
    mutations,
    inputKey: inputKey(input),
    trace,
    step,
    checkpoints,
    divergence,
  });

  /* ---------- load, honouring a deep link if there is one ---------- */
  useEffect(() => {
    const store = usePlayer.getState();
    const q = new URLSearchParams(window.location.search);
    const linked = decodeShare(def, q);
    const gaveInput = q.get('a') !== null;

    // A link that names a bug but not an input should land on an input that
    // actually exercises it — otherwise the page opens on "no divergence here",
    // which is true but useless.
    let start: Input | undefined = gaveInput ? linked.input : undefined;
    let found: CeOutcome | null = null;
    if (linked.mutations.length && !gaveInput) {
      const hit = findCounterexample(def, new Set(linked.mutations));
      if (hit) {
        start = hit.input;
        found = outcomeOf(hit);
      }
    }

    store.setLang(linked.lang);
    store.load(def, start, linked.mutations);
    usePlayer.getState().setCe(found);
    if (linked.step > 0) {
      setTimeout(() => usePlayer.getState().setStep(linked.step), 0);
    }
  }, [def]);

  /* ---------- keep the URL shareable ---------- */
  useEffect(() => {
    if (loadedSlug !== def.slug) return;
    const p = encodeShare({ input, step, mutations, lang }, def.fields);
    const url = `${window.location.pathname}?${p.toString()}`;
    window.history.replaceState(null, '', url);
  }, [input, step, mutations, lang, def.slug, def.fields, loadedSlug]);

  /* ---------- keyboard: this is a tool, not a page ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const s = usePlayer.getState();
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) s.nextEvent(1);
        else s.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) s.nextEvent(-1);
        else s.prev();
      } else if (e.key === ' ') {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === 'Home') {
        e.preventDefault();
        s.first();
      } else if (e.key === 'End') {
        e.preventDefault();
        s.last();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- autoplay ---------- */
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => usePlayer.getState().next(), 720 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed]);

  /** Loading a preset also finds an input that actually exercises it. */
  const pickVariant = useCallback(
    (id: string | null) => {
      const store = usePlayer.getState();
      if (!id) {
        store.setMutations([]);
        store.setCe(null);
        return;
      }
      const variant = def.variants.find((v) => v.id === id);
      if (!variant) return;
      const hit = findCounterexample(def, new Set(variant.mutations));
      store.load(def, hit?.input ?? store.input, variant.mutations);
      store.setCe(hit ? outcomeOf(hit) : null);
    },
    [def],
  );

  const toggleMutation = useCallback((id: string) => {
    usePlayer.getState().toggleMutation(id);
  }, []);

  const current = trace && loadedSlug === def.slug ? trace.steps[step] : undefined;
  const previous = trace && step > 0 ? trace.steps[step - 1] : undefined;
  const view = useMemo(
    () => (trace && current ? resolveLens(def.lens, current, trace.oracle) : null),
    [def.lens, current, trace],
  );

  const activeSet = useMemo(() => new Set(mutations), [mutations]);
  const variantId = matchVariant(def, mutations);
  const tab: Tab = chosenTab ?? (mutations.length ? 'buglab' : 'visualize');
  const shownCode = codeFor(def, activeSet, lang);
  const changedLines = mutatedLines(def, activeSet, lang);
  const activeCheckpoint = blocking !== null ? checkpoints[blocking] : null;

  /* ---------- the rail is reference material, so let it be sized ---------- */
  const gridRef = useRef<HTMLDivElement>(null);
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL);
  // The rail's width is applied as an inline style and must not leak into
  // the stacked layout, so the breakpoint is read rather than guessed.
  const isWide = useMinWidth(1024);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const right = grid.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => {
      setRailWidth(Math.max(MIN_RAIL, Math.min(MAX_RAIL, right - ev.clientX)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  if (!trace || !current || !view || loadedSlug !== def.slug) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="font-mono text-xs text-muted">building trace…</p>
      </div>
    );
  }

  const showRail = density !== 'focus';

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="bg-instrument" aria-hidden />

      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-30 bg-ground px-3 pb-2 pt-3 sm:px-5 sm:pt-4">
        <div
          className="mx-auto max-w-[1500px] overflow-hidden rounded-[16px] border border-hairline-strong"
          style={{
            background: 'linear-gradient(180deg, var(--raised), var(--panel))',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 sm:px-4">
            <Wordmark size="sm" />
            <span className="hidden h-4 w-px bg-hairline-strong sm:block" />
            <h1 className="font-semibold tracking-tight text-ink">{def.name}</h1>
            <span className="label hidden sm:inline">{CATEGORY_LABEL[def.category]}</span>

            <div className="ml-auto flex items-center gap-2.5">
              {trace.truncated && (
                <span className="rounded-[6px] border border-danger-edge bg-danger-dim px-2 py-1 font-mono text-[0.62rem] text-danger">
                  did not terminate — trace capped
                </span>
              )}
              <LadderLinks slug={def.slug} />
              <ShareMenu title={`${def.name} — AlgoScope`} />
              <ThemeSelect />
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-hairline px-2 sm:px-3">
            {TABS.map((t) => {
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  title={t.hint}
                  aria-current={isActive ? 'true' : undefined}
                  className={`group relative whitespace-nowrap px-3 py-2.5 font-mono text-[0.78rem] transition-colors ${
                    isActive ? 'text-accent' : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                  {t.id === 'buglab' && variantId && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-danger align-middle" />
                  )}
                  <span
                    className={`absolute inset-x-3 bottom-0 h-[2px] origin-center rounded-full bg-accent transition-transform duration-200 ease-out ${
                      isActive ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 pt-3 sm:px-6">
        {tab === 'understand' && <Understand def={def} onStart={() => setTab('visualize')} />}

        {tab === 'yourcode' &&
          (def.userLane ? (
            <CodeLab def={def} lane={def.userLane} />
          ) : (
            <div className="mx-auto max-w-xl py-10 text-center">
              <p className="text-[0.95rem] leading-relaxed text-muted">
                This algorithm has no lane yet. A lane needs an input the reader can be handed —
                an array, a list, a tree, a maze, an edge list — and a way to compare the answer
                with the one the reference gives. Rather than show a trace that looks wrong for a reason that
                is about this website, nothing is offered here.
              </p>
            </div>
          ))}

        {tab === 'complexity' && (
          <div className="mx-auto max-w-3xl">
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              How the work actually grows
            </h2>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">
              Nothing here is inferred from the source. The algorithm was re-run at each input size
              with the counters on, and the growth curve was fitted to what it did.
            </p>
            <div className="mt-6">
              <GrowthChart def={def} />
            </div>
          </div>
        )}

        {(tab === 'visualize' || tab === 'buglab') && (
          <div className="flex flex-col gap-5">
            {tab === 'buglab' && (
              <BugLab
                def={def}
                variantId={variantId}
                mutations={mutations}
                onPick={pickVariant}
                onToggle={toggleMutation}
                onReset={() => usePlayer.getState().setMutations([])}
                divergence={divergence}
                totalSteps={trace.steps.length}
                onJump={(s) => usePlayer.getState().setStep(s)}
                ce={ce}
              />
            )}

            <div
              ref={gridRef}
              className={
                showRail ? 'flex flex-col gap-5 lg:flex-row lg:items-start' : 'flex flex-col'
              }
            >
              {/* ---------------- stage column ---------------- */}
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="rounded-xl border border-hairline bg-panel">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 sm:px-6">
                    <div className="min-w-[16rem] flex-1">
                      <InputEditor
                        key={`${input.array?.join(',') ?? ''}|${input.target ?? ''}`}
                        def={def}
                        input={input}
                        onChange={(i) => {
                          setPresetLabel(undefined);
                          usePlayer.getState().setInput(i);
                        }}
                      />
                    </div>
                  </div>

                  <div className="px-4 py-7 sm:px-8 sm:py-10">
                    <Stage
                      step={current}
                      previous={previous}
                      view={view}
                      primary={def.lens.primary}
                    />
                  </div>

                  <Narration step={current} />

                  <div className="flex flex-col gap-3 px-4 py-3 sm:px-6">
                    <Timeline
                      steps={trace.steps}
                      step={step}
                      onScrub={(s) => usePlayer.getState().setStep(s)}
                      divergeAt={divergence?.index ?? null}
                      showInvariant={Boolean(def.lens.invariant)}
                    />
                    <Controls
                      step={step}
                      total={trace.steps.length}
                      playing={playing}
                      speed={speed}
                      density={density}
                      quizEnabled={quizEnabled}
                      onFirst={() => usePlayer.getState().first()}
                      onPrev={() => usePlayer.getState().prev()}
                      onNext={() => usePlayer.getState().next()}
                      onLast={() => usePlayer.getState().last()}
                      onEvent={(d) => usePlayer.getState().nextEvent(d)}
                      onPlay={(on) => usePlayer.getState().setPlaying(on)}
                      onSpeed={(s) => usePlayer.getState().setSpeed(s)}
                      onDensity={(d) => usePlayer.getState().setDensity(d)}
                      onQuiz={(on) => usePlayer.getState().setQuizEnabled(on)}
                    />
                  </div>
                </div>

                {activeCheckpoint && (
                  <Checkpoint
                    checkpoint={activeCheckpoint}
                    onAnswer={(p) => usePlayer.getState().answer(activeCheckpoint.at, p)}
                    onContinue={() => usePlayer.getState().dismissBlocking()}
                  />
                )}

                <div className="rounded-xl border border-hairline bg-panel p-4">
                  <Panel
                    label="Try an edge case"
                    aside={
                      <span className="font-mono text-[0.62rem] text-faint">
                        hover for why it matters
                      </span>
                    }
                  >
                    <EdgeCaseChips
                      def={def}
                      activeLabel={presetLabel}
                      onPick={(i, label) => {
                        setPresetLabel(label);
                        usePlayer.getState().setInput(i);
                      }}
                    />
                    {presetLabel && (
                      <p className="mt-1 text-[0.8rem] leading-snug text-muted">
                        {def.edgeCases.find((e) => e.label === presetLabel)?.why}
                      </p>
                    )}
                  </Panel>
                </div>
              </div>

              {/* ---------------- rail: the code, and nothing else ---------------- */}
              {showRail && (
                <aside
                  style={isWide ? { width: railWidth } : undefined}
                  className="relative flex w-full min-w-0 shrink-0 flex-col gap-4"
                >
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize the code panel"
                    tabIndex={0}
                    onPointerDown={startResize}
                    onDoubleClick={() => setRailWidth(DEFAULT_RAIL)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') setRailWidth((w) => Math.min(MAX_RAIL, w + 32));
                      if (e.key === 'ArrowRight') setRailWidth((w) => Math.max(MIN_RAIL, w - 32));
                    }}
                    title="Drag to resize · double-click to reset"
                    className="group absolute -left-3.5 top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none lg:block"
                  >
                    <span className="absolute left-1/2 top-0 h-full w-px bg-transparent transition-colors group-hover:bg-accent-edge" />
                    <span className="absolute left-1/2 top-8 h-10 w-[3px] -translate-x-1/2 rounded-full bg-hairline-strong transition-colors group-hover:bg-accent" />
                  </div>

                  {view.invariant && <InvariantPanel view={view} />}

                  <div className="rounded-xl border border-hairline bg-panel p-4">
                    <Panel
                      label="Code"
                      aside={
                        <span className="font-mono text-[0.62rem] text-faint">
                          line {current.line}
                        </span>
                      }
                    >
                      <LangTabs value={lang} onChange={usePlayer.getState().setLang} />
                      <CodePanel
                        code={shownCode}
                        activeLine={current.line}
                        changedLines={changedLines}
                      />
                    </Panel>
                  </div>
                </aside>
              )}
            </div>

            {/* Reference material, given a full-width row of its own. Stacked in
                the sidebar it squeezed the code into a column too narrow to read
                it in, which defeats the point of showing code beside state. */}
            {showRail && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-hairline bg-panel p-4">
                  <Panel label="Variables">
                    <VariablesPanel step={current} showDerived={density === 'full'} />
                  </Panel>
                </div>

                <div className="rounded-xl border border-hairline bg-panel p-4">
                  <Panel
                    label="Call stack"
                    aside={
                      <span className="font-mono text-[0.62rem] text-faint">
                        depth {current.frames.length}
                      </span>
                    }
                  >
                    <CallStackView frames={current.frames} />
                  </Panel>
                </div>

                <div className="rounded-xl border border-hairline bg-panel p-4">
                  <Panel label="Operations so far">
                    <CountersPanel step={current} previous={previous} />
                  </Panel>
                </div>

                <div className="rounded-xl border border-hairline bg-panel p-4">
                  <Panel
                    label="Ask about this step"
                    aside={
                      <span className="font-mono text-[0.62rem] text-faint">reads state only</span>
                    }
                  >
                    <AskWhy
                      trace={trace}
                      step={current}
                      previous={previous}
                      view={view}
                      code={shownCode}
                    />
                  </Panel>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <SignalNotice />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Understand({ def, onStart }: { def: AlgorithmDef; onStart: () => void }) {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <p className="label">{CATEGORY_LABEL[def.category]}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-[2.5rem] sm:leading-[1.05]">
        {def.name}
      </h2>
      <p className="mt-2 text-lg leading-snug text-muted">{def.tagline}</p>

      <div className="mt-8 flex flex-col gap-4">
        {def.intuition.map((p, i) => (
          <p key={i} className="text-[1rem] leading-relaxed text-ink-2">
            {p}
          </p>
        ))}
      </div>

      {def.lens.invariant && (
        <div className="mt-8 overflow-hidden rounded-xl border border-hairline bg-panel">
          <div className="border-l-2 border-l-accent p-5">
            <p className="label mb-2">The promise this algorithm keeps</p>
            <p className="text-[1rem] leading-snug text-ink">{def.lens.invariant.text}</p>
            <p className="mt-2.5 text-[0.88rem] leading-relaxed text-muted">
              {def.lens.invariant.why}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-panel p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="label">Time</p>
            <span className="font-mono text-[0.6rem] text-faint">stated bound</span>
          </div>
          <p className="mt-1.5 font-mono text-[0.95rem] text-ink">{def.complexity.time}</p>
          <p className="mt-2.5 text-[0.76rem] leading-snug text-muted">
            The measurement that backs this up is on the Complexity tab, where the algorithm is
            re-run at increasing sizes and the curve is fitted to what actually happened.
          </p>
        </div>
        {/* Space used to be a hardcoded string sitting beside a measured one, in
            the same typeface and at the same size — which said, without ever
            claiming it, that the two were the same kind of fact. */}
        <SpacePanel def={def} />
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-8 inline-flex items-center gap-2 rounded-[8px] bg-accent px-4 py-2.5 text-[0.92rem] font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        Step through it
        <ArrowRightIcon size={15} />
      </button>
    </div>
  );
}

function BugLab({
  def,
  variantId,
  mutations,
  onPick,
  onToggle,
  onReset,
  divergence,
  totalSteps,
  onJump,
  ce,
}: {
  def: AlgorithmDef;
  variantId: string | null;
  mutations: string[];
  onPick: (id: string | null) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  divergence: Divergence | null;
  totalSteps: number;
  onJump: (s: number) => void;
  ce: CeOutcome | null;
}) {
  const variant = variantId ? def.variants.find((v) => v.id === variantId) : undefined;

  return (
    <div className="rounded-xl border border-hairline bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Bug Lab</h2>
          <p className="mt-1 text-[0.88rem] leading-snug text-muted">
            Break the algorithm yourself, or load one of the classic mistakes. Either way it runs
            beside a correct version on the same input, the two traces are compared step by step,
            and the first moment they disagree is located. Computed, not guessed.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onPick(null)}
            className={[
              'rounded-[3px] border px-2.5 py-1.5 font-mono text-[0.68rem] transition-colors',
              !variantId
                ? 'border-accent-edge bg-accent-dim text-accent'
                : 'border-hairline bg-panel text-muted hover:text-ink-2',
            ].join(' ')}
          >
            correct version
          </button>
          {def.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(v.id)}
              title={v.blurb}
              className={[
                'rounded-[3px] border px-2.5 py-1.5 font-mono text-[0.68rem] transition-colors',
                variantId === v.id
                  ? 'border-danger-edge bg-danger-dim text-danger'
                  : 'border-hairline bg-panel text-muted hover:text-ink-2',
              ].join(' ')}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="label mb-2.5">Change one decision in the code</p>
        <MutationPalette def={def} active={mutations} onToggle={onToggle} onReset={onReset} />
      </div>

      {mutations.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          {variant && (
            <p className="rounded-[7px] border border-hairline bg-sunk px-3 py-2 text-[0.85rem] text-ink-2">
              <span className="font-mono text-[0.62rem] uppercase tracking-wider text-muted">
                symptom ·{' '}
              </span>
              {variant.blurb}
            </p>
          )}
          <DivergencePanel
            explanation={variant?.explanation}
            divergence={divergence}
            totalSteps={totalSteps}
            onJump={onJump}
            ce={ce}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * C++ / C / Java.
 *
 * Every version is a strict line-for-line transliteration, so line 7 is the
 * same statement whichever tab is showing — which is what lets the highlight,
 * the mutation edits and the trace's line numbers stay valid across a switch.
 * Nothing is re-run: the choice is purely how the source reads.
 */
function LangTabs({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Source language"
      className="mb-2.5 inline-flex rounded-[7px] border border-hairline bg-sunk p-[3px]"
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="tab"
          aria-selected={l === value}
          onClick={() => onChange(l)}
          className={`rounded-[5px] px-2.5 py-1 font-mono text-[0.68rem] transition-colors ${
            l === value
              ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
              : 'text-faint hover:text-ink-2'
          }`}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The ladders this algorithm is a rung of.
 *
 * Worth a place in the header rather than a footnote: an algorithm read on its
 * own is a technique, and the same algorithm read as one rung of a ladder is an
 * answer to "why not the simpler thing" — which is the question an interview
 * actually asks.
 */
function LadderLinks({ slug }: { slug: string }) {
  const ladders = laddersFor(slug);
  if (ladders.length === 0) return null;

  return (
    <>
      {ladders.map((l) => (
        <Link
          key={l.slug}
          href={`/ladder/${l.slug}`}
          title={`See every approach to ${l.name}, measured side by side`}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:border-accent-edge hover:text-accent"
        >
          <LadderIcon size={12} />
          {l.rungs.length} approaches
        </Link>
      ))}
    </>
  );
}

/** What the player needs to know about a counterexample, and nothing more. */
function outcomeOf(hit: Counterexample): CeOutcome {
  return {
    label: hit.label,
    answerDiffers: hit.answerDiffers,
    correct: hit.correct,
    yours: hit.yours,
  };
}
