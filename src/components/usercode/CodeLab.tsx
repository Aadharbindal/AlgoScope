'use client';

import { useMemo, useState } from 'react';
import { CodePanel } from '@/components/player/CodePanel';
import { InputEditor } from '@/components/player/InputEditor';
import { CountersPanel, Narration, Panel, VariablesPanel } from '@/components/player/Panels';
import { Timeline } from '@/components/player/Timeline';
import { ArrowRightIcon, CheckCircleIcon, RestartIcon } from '@/components/site/Icons';
import { ArrayView } from '@/components/viz/ArrayView';
import {
  AlgorithmDef,
  Input,
  laneLangs,
  USER_LANG_LABEL,
  UserLane,
  UserLang,
} from '@/lib/algorithms/types';
import { describeInput } from '@/lib/algorithms/input';
import { resolveLens } from '@/lib/trace/lens';
import { checkUserCode, UserVerdict } from '@/lib/usercode/check';
import { bindingNote } from '@/lib/usercode/bind';
import { countersAreMeasured, runUserIn } from '@/lib/usercode/dispatch';
import { UserRun } from '@/lib/usercode/run';
import { usePlayer } from '@/store/player';

/** The language to open in: the one being read, if this lane offers it. */
const openingLang = (lane: UserLane, reading: UserLang): UserLang => {
  const offered = laneLangs(lane);
  return offered.includes(reading) ? reading : offered[0];
};

/**
 * The reader's own code, run for real.
 *
 * Everything below the editor is the same machinery the built-in algorithms
 * use — the trace format is identical, so the player, the timeline and the
 * counterexample search all work unchanged on code we have never seen.
 */
export function CodeLab({ def, lane }: { def: AlgorithmDef; lane: UserLane }) {
  // Open in whichever language the code panel is already showing, so the lane
  // never silently switches the reader to a language they were not reading.
  const displayLang = usePlayer((s) => s.lang);
  const [lang, setLang] = useState<UserLang>(() => openingLang(lane, displayLang));
  const [source, setSource] = useState(() => lane.starters[openingLang(lane, displayLang)]!);
  const [input, setInput] = useState<Input>(def.defaultInput);
  const [run, setRun] = useState<UserRun | null>(null);
  const [verdict, setVerdict] = useState<UserVerdict | null>(null);
  const [step, setStep] = useState(0);
  const [usedInput, setUsedInput] = useState<Input>(def.defaultInput);

  const pickLang = (next: UserLang) => {
    setLang(next);
    setSource(lane.starters[next]!);
    setRun(null);
    setVerdict(null);
  };

  const execute = (on?: Input) => {
    const v = checkUserCode(def, source, lane, lang);
    setVerdict(v);
    // Trace the input that actually exposes the problem, if there is one —
    // stepping through a run that behaves correctly explains nothing.
    const target = on ?? v.counterexample?.input ?? input;
    setUsedInput(target);
    setRun(runUserIn(def, source, lang, target, lane));
    setStep(0);
  };

  const trace = run?.ok ? run.trace : null;
  const current = trace ? trace.steps[Math.min(step, trace.steps.length - 1)] : undefined;
  const previous = trace && step > 0 ? trace.steps[step - 1] : undefined;

  /**
   * If the reader happens to use the same variable names, this algorithm's
   * lens fits their code and the regions light up. That is an inference about
   * names, not a verified interpretation, so it says so.
   */
  const lensFits = useMemo(() => {
    if (!trace || def.lens.pointers.length === 0) return false;
    const names = new Set(trace.steps.flatMap((s) => Object.keys(s.vars)));
    return def.lens.pointers.every((p) => names.has(p.var));
  }, [trace, def.lens.pointers]);

  const view = useMemo(() => {
    if (!current) return null;
    const resolved = resolveLens(def.lens, current, {});
    // The invariant leans on oracle values this lane cannot compute.
    return { ...resolved, invariant: undefined };
  }, [def.lens, current]);

  return (
    <div className="flex flex-col gap-5">
      {/* -------------------------------- editor ------------------------------- */}
      <div className="rounded-xl border border-hairline bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Your code</h2>
            <p className="mt-1 text-[0.88rem] leading-snug text-muted">
              Write <span className="font-mono text-ink-2">{lane.fnName}</span> in{' '}
              {USER_LANG_LABEL[lang]}. It is run against the reference on dozens of inputs, and if
              the two ever disagree you get the smallest input that proves it &mdash; then you can
              step through your own execution.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => pickLang(lang)}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.68rem] text-muted transition-colors hover:text-ink-2"
            >
              <RestartIcon size={12} />
              reset
            </button>
            <button
              type="button"
              onClick={() => execute()}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent"
            >
              run it
              <ArrowRightIcon size={13} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            role="tablist"
            aria-label="Language to write in"
            className="inline-flex rounded-[7px] border border-hairline bg-sunk p-[3px]"
          >
            {laneLangs(lane).map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={l === lang}
                onClick={() => pickLang(l)}
                className={`rounded-[5px] px-2.5 py-1 font-mono text-[0.68rem] transition-colors ${
                  l === lang
                    ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
                    : 'text-faint hover:text-ink-2'
                }`}
              >
                {USER_LANG_LABEL[l]}
              </button>
            ))}
          </div>
          <p className="font-mono text-[0.66rem] leading-snug text-faint">
            {lang === 'js'
              ? 'browser engine \u00b7 statement-level only'
              : 'this site\u2019s interpreter \u00b7 int is 32 bits, so overflow is real'}
          </p>
        </div>

        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          rows={Math.min(26, source.split('\n').length + 2)}
          className="mt-3 w-full resize-y rounded-[7px] border border-hairline bg-sunk p-3 font-mono text-[0.78rem] leading-[1.7] text-ink outline-none transition-colors focus:border-accent-edge"
        />

        <div className="mt-3 border-t border-hairline pt-3">
          <InputEditor
            key={JSON.stringify(input)}
            def={def}
            input={input}
            onChange={(i) => {
              setInput(i);
              execute(i);
            }}
          />
        </div>

        <p className="mt-3 text-[0.72rem] leading-snug text-faint">
          {lang === 'js' ? (
            <>
              This runs in your own browser, like a console &mdash; nothing is uploaded, and code is
              never read from a link. Only statement boundaries are visible to this lane, so
              comparison and read counts are not measured, and so are not shown. Calls into helper
              functions are not traced either, so keep it to one function.
            </>
          ) : (
            <>
              This runs on an interpreter written for this site, not a real compiler &mdash; which
              is what lets every comparison, read and write be counted, and{' '}
              <span className="font-mono">int</span> be a genuine 32-bit int. The subset is ints,
              booleans, strings, arrays, <span className="font-mono">vector</span>/
              <span className="font-mono">queue</span>/<span className="font-mono">stack</span>,
              hash maps, structs, functions, and if / while / for; anything outside it is refused
              by name rather than guessed at.
            </>
          )}
        </p>

        {/* What each parameter is handed. Stated, so it is never a surprise. */}
        <p className="mt-2 text-[0.72rem] leading-snug text-faint">
          Your parameters are filled by name: {bindingNote(lane)} A parameter this does not
          recognise takes the next one in that list.
          {lane.note ? ` ${lane.note}` : ''}
        </p>
      </div>

      {/* ------------------------------- verdict ------------------------------- */}
      {run && !run.ok && (
        <div className="rounded-xl border border-danger-edge bg-danger-dim p-4">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-danger">
            could not run
          </p>
          <p className="mt-1.5 text-[0.9rem] leading-snug text-ink">{run.message}</p>
          {run.line !== undefined && (
            <p className="mt-1 font-mono text-[0.7rem] text-muted">line {run.line}</p>
          )}
        </div>
      )}

      {verdict && run?.ok && <Verdict def={def} verdict={verdict} usedInput={usedInput} />}

      {/* -------------------------------- player ------------------------------- */}
      {trace && current && view && trace.steps.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
          <div className="rounded-xl border border-hairline bg-panel">
            {/* The array, when there is one. A lane whose input is a tree, a maze
                or an edge list has nothing to draw here, and an empty row of
                cells would say something false about what the code is holding. */}
            <div className={current.structs.arr?.kind === 'array' && current.structs.arr.values.length > 0 ? 'px-4 py-7 sm:px-8' : 'pt-4'}>
              {current.structs.arr?.kind === 'array' && current.structs.arr.values.length > 0 && (
                <ArrayView
                  struct={current.structs.arr}
                  previous={previous?.structs.arr?.kind === 'array' ? previous.structs.arr : undefined}
                  pointers={lensFits ? view.pointers : []}
                  regions={lensFits ? view.regions : []}
                  event={undefined}
                  step={current.i}
                />
              )}
            </div>

            <Narration step={current} total={trace.steps.length} />

            <div className="px-4 py-3 sm:px-6">
              <Timeline steps={trace.steps} step={step} onScrub={setStep} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="rounded-[7px] border border-hairline bg-sunk px-3 py-1.5 font-mono text-xs text-ink-2 transition-colors hover:border-hairline-strong disabled:opacity-35"
                >
                  ← back
                </button>
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(trace.steps.length - 1, s + 1))}
                  disabled={step >= trace.steps.length - 1}
                  className="rounded-[7px] border border-accent-edge bg-accent-dim px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-on-accent disabled:opacity-35"
                >
                  step →
                </button>
                <span className="ml-auto font-mono text-[0.68rem] text-faint">
                  {trace.steps.length.toLocaleString()} statements executed
                  {trace.truncated && ' · capped, your code may not terminate'}
                </span>
              </div>
              {lensFits && (
                <p className="mt-2.5 font-mono text-[0.66rem] leading-relaxed text-faint">
                  Your variable names match this algorithm&rsquo;s lens, so the same regions are
                  drawn. That is an inference from names — it has not been verified against your
                  logic the way the built-in run is.
                </p>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-xl border border-hairline bg-panel p-4">
              <Panel
                label="Your code"
                aside={<span className="font-mono text-[0.62rem] text-faint">line {current.line}</span>}
              >
                <CodePanel code={source} activeLine={current.line} />
              </Panel>
            </div>
            <div className="rounded-xl border border-hairline bg-panel p-4">
              <Panel label="Variables">
                <VariablesPanel step={current} showDerived={false} />
              </Panel>
            </div>
            {countersAreMeasured(lang) && (
              <div className="rounded-xl border border-hairline bg-panel p-4">
                <Panel
                  label="Operations so far"
                  aside={<span className="font-mono text-[0.62rem] text-faint">measured</span>}
                >
                  <CountersPanel step={current} previous={previous} />
                </Panel>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Verdict({
  def,
  verdict,
  usedInput,
}: {
  def: AlgorithmDef;
  verdict: UserVerdict;
  usedInput: Input;
}) {
  if (verdict.error) {
    return (
      <div className="rounded-xl border border-danger-edge bg-danger-dim p-4">
        <p className="font-mono text-[0.6rem] uppercase tracking-wider text-danger">
          threw on an input
        </p>
        <p className="mt-1.5 text-[0.9rem] leading-snug text-ink">
          Your code failed on <span className="font-mono">{verdict.error.label}</span>.
        </p>
        <p className="mt-1 font-mono text-[0.72rem] text-muted">{verdict.error.message}</p>
      </div>
    );
  }

  if (!verdict.counterexample) {
    return (
      <div className="rounded-xl border border-accent-edge bg-accent-dim p-4">
        <div className="flex items-start gap-2.5">
          <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="text-[0.92rem] leading-snug text-ink">
              Agrees with the reference on all {verdict.tried} inputs tried, including every edge
              case on this page.
            </p>
            <p className="mt-1.5 text-[0.8rem] leading-snug text-muted">
              That is evidence, not proof — no finite set of inputs can be. But it is a good deal
              more than a submission verdict tells you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const ce = verdict.counterexample;
  return (
    <div className="rounded-xl border border-danger-edge bg-danger-dim p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-danger">
          smallest input that breaks it
        </span>
        <span className="ml-auto font-mono text-[0.68rem] text-muted">
          found in {verdict.tried} tries · {ce.label}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-[7px] border border-danger-edge/60">
        <table className="w-full min-w-[380px] font-mono text-xs">
          <tbody>
            <tr className="border-b border-danger-edge/40">
              <td className="px-3 py-1.5 text-muted">input</td>
              <td className="px-3 py-1.5 text-ink">{describeInput(def, ce.input)}</td>
            </tr>
            <tr className="border-b border-danger-edge/40">
              <td className="px-3 py-1.5 text-muted">correct</td>
              <td className="px-3 py-1.5 text-accent">{ce.correct}</td>
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-muted">yours</td>
              <td className="px-3 py-1.5 text-danger">{ce.yours}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[0.85rem] leading-snug text-ink-2">
        The trace below is your code on exactly this input
        {usedInput === ce.input ? '' : ''}. Step through it and find the moment the two answers
        part company.
      </p>
    </div>
  );
}
