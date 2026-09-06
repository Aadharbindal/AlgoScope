'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ExpandIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
} from '@/components/site/Icons';
import { Select } from '@/components/site/Select';
import { ArrayView } from '@/components/viz/ArrayView';
import { ListView } from '@/components/viz/ListView';
import { ALGORITHMS, bySlug } from '@/lib/algorithms';
import { AlgorithmDef, buildTrace } from '@/lib/algorithms/types';
import { resolveLens } from '@/lib/trace/lens';
import { Scalar, Step, Trace } from '@/lib/trace/types';

/* ------------------------- derived, from the trace ------------------------ */

/**
 * Open on the step that carries the concept. The first checkpoint already
 * marks exactly that step for each algorithm, so reuse it rather than
 * inventing a second notion of "the interesting moment".
 */
function openingStep(def: AlgorithmDef, trace: Trace): number {
  for (const cp of def.checkpoints) {
    try {
      const at = cp.locate(trace);
      if (at > 0 && at < trace.steps.length) return at;
    } catch {
      /* fall through */
    }
  }
  return Math.min(trace.steps.length - 1, Math.floor(trace.steps.length / 3));
}

const fmt = (v: Scalar | undefined): string => {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && !Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return String(v);
};

/** What a line evaluated to, shown in the gutter beside it. */
function resultFor(s: Step): string | null {
  const e = s.event;
  if (e?.type === 'compare') return e.result ? 'True' : 'False';
  if (e?.type === 'found' && e.at.kind === 'cell') return String(e.at.index);
  if (e?.type === 'return') return e.value === null ? 'void' : String(e.value);
  if (e?.type === 'swap') return 'swapped';
  if (s.changed.length > 0) return fmt(s.vars[s.changed[0]]);
  return null;
}

/** Results for lines executed recently enough to still be relevant. */
function recentResults(trace: Trace, at: number): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = Math.max(0, at - 9); i <= at; i++) {
    const r = resultFor(trace.steps[i]);
    if (r !== null) out.set(trace.steps[i].line, r);
  }
  return out;
}

function statusFor(s: Step): { text: string; tone: 'good' | 'bad' | 'plain' } | null {
  const e = s.event;
  if (!e) return null;
  switch (e.type) {
    case 'compare':
      return e.result
        ? { text: 'Condition satisfied.', tone: 'good' }
        : { text: 'Condition not met.', tone: 'plain' };
    case 'found':
      return { text: 'Target found.', tone: 'good' };
    case 'fail':
      return { text: 'Search space exhausted.', tone: 'bad' };
    case 'swap':
      return { text: 'Values exchanged.', tone: 'plain' };
    case 'link':
      return { text: 'Pointer rewired.', tone: 'plain' };
    case 'push':
      return { text: 'Appended to buffer.', tone: 'plain' };
    case 'write':
      return { text: 'Written back.', tone: 'plain' };
    case 'call':
      return { text: 'Entering call.', tone: 'plain' };
    case 'return':
      return { text: 'Returning to caller.', tone: 'plain' };
    default:
      return null;
  }
}

const summarise = (values: number[] | undefined) => {
  if (!values || values.length === 0) return '[]';
  const shown = values.length > 9 ? [...values.slice(0, 9), '…'] : values;
  return `[${shown.join(', ')}]`;
};

/* -------------------------------- component ------------------------------- */

const CODE_WINDOW = 5;

/** Which pointer's dereference is worth the two rows the panel can spare. */
const DEREF_RANK: Record<string, number> = {
  probe: 0,
  cursor: 1,
  runner: 2,
  'window-start': 3,
  'window-end': 4,
  boundary: 5,
  aux: 6,
};

export function HeroDemo() {
  const [slug, setSlug] = useState('binary-search');
  const def = bySlug(slug) ?? ALGORITHMS[0];

  const trace = useMemo(() => buildTrace(def, def.defaultInput), [def]);
  const opening = useMemo(() => openingStep(def, trace), [def, trace]);

  const [step, setStep] = useState(opening);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const at = Math.min(step, trace.steps.length - 1);
  const current = trace.steps[at];
  const previous = at > 0 ? trace.steps[at - 1] : undefined;
  const atEnd = at >= trace.steps.length - 1;

  const view = useMemo(
    () => resolveLens(def.lens, current, trace.oracle),
    [def.lens, current, trace.oracle],
  );

  // Playback stops at the end by derivation rather than by writing state back
  // from an effect — the flag stays set, it simply has nowhere left to go.
  const isPlaying = playing && !atEnd;

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setTimeout(() => setStep((s) => s + 1), 900 / speed);
    return () => window.clearTimeout(id);
  }, [isPlaying, speed, at]);

  const switchTo = (nextSlug: string) => {
    const nextDef = bySlug(nextSlug) ?? ALGORITHMS[0];
    const nextTrace = buildTrace(nextDef, nextDef.defaultInput);
    setPlaying(false);
    setSlug(nextSlug);
    setStep(openingStep(nextDef, nextTrace));
  };

  const code = def.code.cpp.split('\n');
  const from = Math.max(0, Math.min(current.line - 3, code.length - CODE_WINDOW));
  const window_ = code.slice(from, from + CODE_WINDOW);
  const results = recentResults(trace, at);
  const status = statusFor(current);

  const primary = current.structs[def.lens.primary];
  const prevPrimary = previous?.structs[def.lens.primary];

  // Pointer dereferences read better than raw indices — arr[mid] = 38. The
  // probe is the one being tested this step, so it earns the space first.
  const derefs = [...view.pointers]
    .sort((a, b) => (DEREF_RANK[a.role] ?? 9) - (DEREF_RANK[b.role] ?? 9))
    .map((p) => {
      const s = current.structs[p.on];
      if (!s || s.kind !== 'array') return null;
      if (p.index < 0 || p.index >= s.values.length) return null;
      return { label: `${p.on}[${p.name}]`, value: String(s.values[p.index]) };
    })
    .filter((x): x is { label: string; value: string } => x !== null)
    .slice(0, 2);

  const vars = Object.entries(current.vars).slice(0, 5);

  return (
    <div
      className="overflow-hidden rounded-lg border border-hairline bg-panel"
      style={{ boxShadow: 'var(--lift)' }}
    >
      {/* ------------------------------ header ------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-raised px-3.5 py-2.5">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <Select
            value={slug}
            onChange={switchTo}
            label="Choose an algorithm"
            options={ALGORITHMS.map((a) => ({ value: a.slug, label: a.name.toLowerCase() }))}
          />
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.68rem] text-muted">
          <span>
            arr = <span className="text-ink-2">{summarise(def.defaultInput.array)}</span>
          </span>
          {def.defaultInput.target !== undefined && (
            <span>
              target = <span className="text-ink-2">{def.defaultInput.target}</span>
            </span>
          )}
        </span>
      </div>

      {/* ------------------------------- stage ------------------------------ */}
      <div className="flex min-h-[9.5rem] items-center px-4 py-5 sm:px-6">
        {primary?.kind === 'array' && (
          <ArrayView
            struct={primary}
            previous={prevPrimary?.kind === 'array' ? prevPrimary : undefined}
            pointers={view.pointers}
            regions={view.regions}
            event={current.event}
            step={current.i}
          />
        )}
        {primary?.kind === 'list' && (
          <ListView
            struct={primary}
            previous={prevPrimary?.kind === 'list' ? prevPrimary : undefined}
          />
        )}
      </div>

      {/* --------------------------- code + state --------------------------- */}
      <div className="grid gap-px border-y border-hairline bg-hairline sm:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="bg-sunk py-2 font-mono text-[0.7rem] leading-[1.75]">
          {window_.map((line, k) => {
            const n = from + k + 1;
            const isActive = n === current.line;
            const result = results.get(n);
            return (
              <div
                key={n}
                className={`flex items-center gap-2 pr-3 ${isActive ? 'bg-accent-dim' : ''}`}
              >
                <span className="flex w-8 shrink-0 items-center justify-end gap-1.5 pl-1.5">
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  <span className={isActive ? 'text-accent' : 'text-faint'}>{n}</span>
                </span>
                <code
                  className={`min-w-0 flex-1 truncate whitespace-pre ${isActive ? 'text-ink' : 'text-muted'}`}
                >
                  {line.length === 0 ? ' ' : line}
                </code>
                {result !== undefined && (
                  <span
                    className={`shrink-0 tabular-nums ${isActive ? 'text-accent' : 'text-faint'}`}
                  >
                    → {result}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 bg-sunk px-3.5 py-2.5 font-mono text-[0.7rem]">
          {vars.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <span className={current.changed.includes(k) ? 'text-accent' : 'text-muted'}>{k}</span>
              <span className="tabular-nums text-ink-2">{fmt(v)}</span>
            </div>
          ))}
          {derefs.map((d) => (
            <div key={d.label} className="flex items-baseline justify-between gap-3">
              <span className="text-muted">{d.label}</span>
              <span className="tabular-nums text-ink-2">{d.value}</span>
            </div>
          ))}
          {status && (
            <div className="mt-1 border-t border-hairline pt-1.5">
              <span
                className={
                  status.tone === 'good'
                    ? 'text-accent'
                    : status.tone === 'bad'
                      ? 'text-danger'
                      : 'text-muted'
                }
              >
                {status.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------ insight ----------------------------- */}
      <div className="flex min-h-[3.6rem] items-start gap-2.5 px-3.5 py-3">
        <CheckCircleIcon size={15} className="mt-[0.15rem] shrink-0 text-accent" />
        <p key={current.i} className="rise text-[0.82rem] leading-snug text-ink-2">
          {current.narration}
        </p>
      </div>

      {/* ----------------------------- controls ----------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-raised px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={at === 0}
          className="inline-flex items-center gap-1.5 rounded-[4px] border border-hairline bg-panel px-2.5 py-1.5 font-mono text-[0.7rem] text-ink-2 transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-35"
        >
          <ArrowLeftIcon size={13} />
          back
        </button>

        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            if (atEnd) setStep(opening);
            else setStep((s) => s + 1);
          }}
          className="inline-flex items-center gap-1.5 rounded-[4px] border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-[0.7rem] text-accent transition-colors hover:bg-accent hover:text-on-accent"
        >
          {atEnd ? (
            <>
              <RestartIcon size={13} />
              replay
            </>
          ) : (
            <>
              step
              <ArrowRightIcon size={13} />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            // At the end, "play" means play it again from the interesting step.
            if (atEnd) {
              setStep(opening);
              setPlaying(true);
              return;
            }
            setPlaying((p) => !p);
          }}
          className="inline-flex items-center gap-1.5 rounded-[4px] border border-hairline bg-panel px-2.5 py-1.5 font-mono text-[0.7rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2"
        >
          {isPlaying ? 'pause' : 'auto play'}
          {isPlaying ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
        </button>

        <span className="ml-auto flex items-center gap-2">
          <Select
            value={String(speed)}
            onChange={(v) => setSpeed(Number(v))}
            label="Playback speed"
            align="end"
            direction="up"
            size="sm"
            className="w-[4.6rem]"
            options={[
              { value: '0.5', label: '0.5x' },
              { value: '1', label: '1.0x' },
              { value: '2', label: '2.0x' },
            ]}
          />

          <Link
            href={`/a/${def.slug}`}
            title="Open the full instrument"
            aria-label="Open the full instrument"
            className="inline-flex h-[1.95rem] w-[1.95rem] items-center justify-center rounded-[4px] border border-hairline bg-panel text-muted transition-colors hover:border-accent-edge hover:text-accent"
          >
            <ExpandIcon size={14} />
          </Link>
        </span>
      </div>
    </div>
  );
}
