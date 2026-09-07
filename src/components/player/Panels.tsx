'use client';

import { ReactNode } from 'react';
import { ResolvedView } from '@/lib/trace/lens';
import { Counters, Scalar, Step } from '@/lib/trace/types';
import { EVENT_LABEL } from './Timeline';

export function Panel({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="label">{label}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

const fmt = (v: Scalar | undefined): string => {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && !Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return String(v);
};

/* ----------------------------- narration ----------------------------- */

/**
 * The narration, and the only thing on this page that is spoken.
 *
 * Stepping is the whole interaction, and the narration is the sentence that
 * changes when you step. Without a live region a reader using a screen reader
 * presses the right arrow and hears nothing at all — the page has moved and
 * said nothing about it. So this is the region, and it carries in words the
 * context a sighted reader takes from the layout: which step, which line, and
 * whether a claim about the algorithm just broke.
 *
 * `polite` rather than `assertive`, because stepping is the reader's own
 * action and interrupting them mid-sentence to confirm it would be worse than
 * waiting. `atomic`, so the whole sentence is re-read rather than only the
 * words that changed — half a sentence is not an explanation.
 */
export function Narration({ step, total }: { step: Step; total?: number }) {
  const broke = [
    step.invariantHolds === false ? 'The invariant no longer holds.' : '',
    step.postconditionHolds === false ? 'The postcondition does not hold.' : '',
    step.costHolds === false ? 'The cost claim does not hold.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="flex min-h-[4.5rem] items-start gap-3 border-y border-hairline bg-panel px-4 py-3.5 sm:px-6"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="mt-[0.2rem] shrink-0 rounded-[7px] border border-hairline bg-sunk px-1.5 py-0.5 font-mono text-[0.6rem] text-muted tabular-nums">
        <span aria-hidden="true">{step.i}</span>
        <span className="sr-only">
          Step {step.i + 1}
          {total ? ` of ${total}` : ''}, line {step.line}.
        </span>
      </span>
      <p key={step.i} className="rise text-[0.95rem] leading-snug text-ink sm:text-base">
        {step.narration}
        {broke && <span className="sr-only"> {broke}</span>}
      </p>
      {step.event && (
        <span className="ml-auto mt-[0.2rem] hidden shrink-0 rounded-[7px] border border-hairline bg-sunk px-2 py-0.5 font-mono text-[0.6rem] text-muted sm:block">
          {EVENT_LABEL[step.event.type]}
        </span>
      )}
    </div>
  );
}

/* ----------------------------- variables ----------------------------- */

export function VariablesPanel({
  step,
  showDerived,
}: {
  step: Step;
  showDerived: boolean;
}) {
  const entries = Object.entries(step.vars);
  const derived = Object.entries(step.derived).filter(([, v]) => v !== null && v !== undefined);
  const changed = new Set(step.changed);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[7px] border border-hairline">
        {entries.length === 0 && (
          <p className="px-3 py-2 font-mono text-xs text-faint">nothing in scope yet</p>
        )}
        {entries.map(([k, v], i) => (
          <div
            key={k}
            className={[
              'flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs',
              i % 2 ? 'bg-panel' : 'bg-sunk',
              changed.has(k) ? 'border-l-2 border-l-accent' : 'border-l-2 border-l-transparent',
            ].join(' ')}
          >
            <span className={changed.has(k) ? 'text-accent' : 'text-muted'}>{k}</span>
            <span
              key={changed.has(k) ? `v${step.i}` : 'stable'}
              className={[
                'tabular-nums',
                changed.has(k) ? 'rounded-[2px] px-1 text-ink flash' : 'text-ink-2',
              ].join(' ')}
            >
              {fmt(v)}
            </span>
          </div>
        ))}
      </div>

      {showDerived && derived.length > 0 && (
        <div>
          <p className="label mb-1.5">Derived · not program state</p>
          <div className="overflow-hidden rounded-[7px] border border-dashed border-hairline-strong">
            {derived.map(([k, v], i) => (
              <div
                key={k}
                className={`flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs ${i % 2 ? 'bg-panel' : 'bg-sunk'}`}
              >
                <span className="text-faint">{k}</span>
                <span className="text-muted tabular-nums">{fmt(v)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[0.7rem] leading-snug text-faint">
            Computed by the instrumentation so the invariant can be checked. Your program never
            holds these values.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ counters ----------------------------- */

const COUNTER_LABELS: { key: keyof Counters; label: string }[] = [
  { key: 'comparisons', label: 'comparisons' },
  { key: 'reads', label: 'reads' },
  { key: 'writes', label: 'writes' },
  { key: 'swaps', label: 'swaps' },
  { key: 'iterations', label: 'iterations' },
  { key: 'calls', label: 'calls' },
  { key: 'maxDepth', label: 'max depth' },
];

export function CountersPanel({ step, previous }: { step: Step; previous?: Step }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[7px] border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-2">
        {COUNTER_LABELS.map(({ key, label }) => {
          const value = step.counters[key];
          const bumped = previous ? previous.counters[key] !== value : false;
          return (
            <div key={key} className="flex flex-col gap-0.5 bg-panel px-2.5 py-2">
              <span className="font-mono text-[0.58rem] uppercase tracking-wider text-faint">
                {label}
              </span>
              <span
                key={bumped ? `b${step.i}` : 'stable'}
                className={`font-mono text-sm tabular-nums ${bumped ? 'text-accent flash' : 'text-ink-2'}`}
              >
                {value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[0.7rem] leading-snug text-faint">
        Educational operation counts, not wall-clock time or machine instructions.
      </p>
    </div>
  );
}

/* ------------------------------ invariant ---------------------------- */

export function InvariantPanel({ view }: { view: ResolvedView }) {
  const inv = view.invariant;
  if (!inv) return null;

  const status = !inv.applicable ? 'idle' : inv.holds ? 'holds' : 'broken';
  const chrome = {
    idle: 'border-hairline bg-sunk text-faint',
    holds: 'border-accent-edge bg-accent-dim text-accent',
    broken: 'border-danger-edge bg-danger-dim text-danger',
  }[status];
  const word = { idle: 'not yet in scope', holds: 'holds', broken: 'broken' }[status];

  return (
    <div className={`rounded-[7px] border p-3 ${chrome}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider opacity-80">
          invariant
        </span>
        <span className="font-mono text-[0.65rem] font-semibold">{word}</span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug text-ink">{inv.text}</p>
      {status === 'broken' && (
        <p className="mt-2 border-t border-danger-edge pt-2 text-[0.75rem] leading-snug text-ink-2">
          {inv.why}
        </p>
      )}
    </div>
  );
}

/* ------------------------- end-of-run claims -------------------------- */

/**
 * The two claims that can only be judged once the run is over.
 *
 * They appear on the last step and nowhere else, because that is the only
 * place there is a result to check or a final count to check it against.
 * Kept beside the invariant rather than folded into it: three different
 * promises, and a reader who sees which one broke has learned something the
 * word "wrong" does not carry.
 */
function ClaimPanel({
  kind,
  claim,
}: {
  kind: string;
  claim: { text: string; why: string; holds: boolean };
}) {
  const chrome = claim.holds
    ? 'border-accent-edge bg-accent-dim text-accent'
    : 'border-danger-edge bg-danger-dim text-danger';

  return (
    <div className={`rounded-[7px] border p-3 ${chrome}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider opacity-80">{kind}</span>
        <span className="font-mono text-[0.65rem] font-semibold">
          {claim.holds ? 'holds' : 'broken'}
        </span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug text-ink">{claim.text}</p>
      {!claim.holds && (
        <p className="mt-2 border-t border-danger-edge pt-2 text-[0.75rem] leading-snug text-ink-2">
          {claim.why}
        </p>
      )}
    </div>
  );
}

export function ClaimsPanel({ view }: { view: ResolvedView }) {
  if (!view.postcondition && !view.cost) return null;
  return (
    <>
      {view.postcondition && <ClaimPanel kind="postcondition" claim={view.postcondition} />}
      {view.cost && <ClaimPanel kind="cost" claim={view.cost} />}
    </>
  );
}
