import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LadderChart, Series } from '@/components/complexity/LadderChart';
import { ArrowRightIcon } from '@/components/site/Icons';
import { Wordmark } from '@/components/site/Wordmark';
import { buildTrace, countOps } from '@/lib/algorithms/types';
import { LADDERS, ladderBySlug, rungDefs } from '@/lib/ladders';
import { encodeShare } from '@/lib/share/link';
import { absolute } from '@/lib/share/site';
import { analyseGrowth, formatOps } from '@/lib/trace/complexity';

/**
 * One problem, every approach, measured side by side.
 *
 * Everything on this page is computed by running the algorithms — the counts,
 * the complexities and the answers alike. Nothing is quoted from the prose that
 * sits beside it, which matters because the prose is the part that could drift:
 * if someone changed an implementation and its stated complexity, the number on
 * this page would move and the claim would stop matching.
 *
 * The answers are shown too, and they are all the same answer. That is the
 * whole premise of a ladder — different techniques, identical question — and
 * showing it is cheaper than asking anyone to take it on trust.
 */

export function generateStaticParams() {
  return LADDERS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata(props: PageProps<'/ladder/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const ladder = ladderBySlug(slug);
  if (!ladder) return { title: 'Not found — AlgoScope' };
  const names = ladder.rungs.map((r) => r.label).join(' → ');
  return {
    title: `${ladder.name}: ${names} — AlgoScope`,
    description: `${ladder.problem} ${ladder.rungs.length} approaches, each traced and each measured.`,
    openGraph: {
      title: `${ladder.name} — ${names}`,
      description: ladder.problem,
      url: absolute(`/ladder/${slug}`),
      siteName: 'AlgoScope',
    },
  };
}

export default async function LadderPage(props: PageProps<'/ladder/[slug]'>) {
  const { slug } = await props.params;
  const ladder = ladderBySlug(slug);
  if (!ladder) notFound();

  const resolved = rungDefs(ladder).map(({ rung, def }) => {
    const points = ladder.growthSizes.map((n) => ({ n, ops: countOps(def, def.makeInput(n)) }));
    const report = analyseGrowth(points, def.projectTo);
    const trace = buildTrace(def, ladder.compareInput);
    return {
      rung,
      def,
      points,
      measured: report.best.model.notation,
      r2: report.best.r2,
      onExample: trace.steps[trace.steps.length - 1]?.counters ?? null,
      answer: String(trace.result),
      link: `/a/${def.slug}?${encodeShare({ input: ladder.compareInput }, def.fields).toString()}`,
    };
  });

  // Two rungs can share a complexity class — the three quadratic sorts do —
  // and when they do, "faster" is decided by constant factors and by the shape
  // of the input, not by the class. Saying so is the difference between a
  // ladder and a ranking.
  const rungs = resolved.map((r, i) => ({
    ...r,
    sharesClassWithBelow: i > 0 && resolved[i - 1].measured === r.measured,
  }));

  const answers = new Set(rungs.map((r) => r.answer));
  const agree = answers.size === 1;
  const baseline = rungs[0]?.onExample;
  const total = (c: typeof baseline) =>
    c ? c.comparisons + c.reads + c.writes + c.calls : 0;

  const series: Series[] = rungs.map((r) => ({
    label: r.rung.label,
    notation: r.measured,
    points: r.points,
  }));

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="bg-instrument" aria-hidden />

      <header className="px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          {/* Wordmark is its own link home; wrapping it in another produces
              nested anchors and a hydration error. */}
          <Wordmark size="sm" />
          <span className="h-4 w-px bg-hairline-strong" />
          <h1 className="font-semibold tracking-tight text-ink">{ladder.name}</h1>
          <span className="label">Approach ladder</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <p className="max-w-3xl text-[1.02rem] leading-relaxed text-ink-2">{ladder.problem}</p>

        {/* ------------------------------ the rungs ----------------------------- */}
        <ol className="mt-8 flex flex-col gap-3">
          {rungs.map((r, i) => {
            const ops = total(r.onExample);
            const base = total(baseline);
            const factor = base > 0 && ops > 0 ? base / ops : null;
            return (
              <li key={r.def.slug} className="rounded-xl border border-hairline bg-panel">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-3 sm:px-5">
                  <span className="font-mono text-[0.7rem] text-faint">{i + 1}</span>
                  <h2 className="font-semibold tracking-tight text-ink">{r.rung.label}</h2>
                  <span className="rounded-[5px] border border-accent-edge bg-accent-dim px-1.5 py-0.5 font-mono text-[0.66rem] text-accent">
                    {r.measured}
                  </span>
                  <span className="font-mono text-[0.64rem] text-faint">measured, R² {r.r2.toFixed(3)}</span>
                  {r.sharesClassWithBelow && (
                    <span className="font-mono text-[0.64rem] text-probe">
                      same class as the rung above
                    </span>
                  )}
                  <Link
                    href={r.link}
                    className="ml-auto inline-flex items-center gap-1.5 font-mono text-[0.68rem] text-accent hover:underline"
                  >
                    step through it
                    <ArrowRightIcon size={12} />
                  </Link>
                </div>

                <div className="grid gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:px-5">
                  <div>
                    <p className="label mb-1">The idea it adds</p>
                    <p className="text-[0.88rem] leading-snug text-ink-2">{r.rung.idea}</p>
                  </div>
                  <div>
                    <p className="label mb-1">What it costs</p>
                    <p className="text-[0.88rem] leading-snug text-muted">{r.rung.tradeoff}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-hairline px-4 py-2.5 font-mono text-[0.68rem] sm:px-5">
                  <span className="text-muted">
                    on the example: <span className="text-ink">{formatOps(ops)}</span> operations
                  </span>
                  {r.onExample && (
                    <span className="text-faint">
                      {r.onExample.comparisons.toLocaleString()} comparisons ·{' '}
                      {r.onExample.writes.toLocaleString()} writes
                    </span>
                  )}
                  {factor !== null && i > 0 && (
                    <span className={factor >= 1.05 ? 'ml-auto text-accent' : 'ml-auto text-muted'}>
                      {factor >= 1.05
                        ? `${factor.toFixed(1)}× less work than rung 1 here`
                        : 'no cheaper than rung 1 on this input'}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* ------------------------- the agreement check ------------------------ */}
        <div
          className={`mt-6 rounded-xl border p-4 ${
            agree ? 'border-hairline bg-panel' : 'border-danger-edge bg-danger-dim'
          }`}
        >
          <p className="label">Same question, same answer</p>
          {agree ? (
            <p className="mt-1.5 text-[0.9rem] leading-snug text-ink-2">
              All {rungs.length} approaches return{' '}
              <span className="font-mono text-accent">{rungs[0]?.answer}</span> on the example input
              — which is what makes the operation counts above a comparison rather than a
              coincidence. The test suite checks this across a spread of inputs, not just this one.
            </p>
          ) : (
            <p className="mt-1.5 text-[0.9rem] leading-snug text-ink">
              These rungs disagree: {[...answers].join(' vs ')}. That is a bug in the ladder, not a
              property of the problem — the comparison below is not meaningful until it is fixed.
            </p>
          )}
        </div>

        {/* ------------------------------- growth ------------------------------- */}
        <section className="mt-8 rounded-xl border border-hairline bg-panel p-4 sm:p-5">
          <h2 className="font-semibold tracking-tight text-ink">How the gap grows</h2>
          <p className="mt-1 max-w-3xl text-[0.85rem] leading-snug text-muted">
            Each approach measured at the same input sizes, using its own worst-case generator —
            the same one its individual complexity page uses. Where two rungs share a complexity
            class their curves run parallel, and which of them is actually quicker depends on
            constant factors and on the shape of the data rather than on the class. Climbing a
            ladder is a change of class; ordering within a class is a different question.
          </p>
          <div className="mt-4">
            <LadderChart series={series} />
          </div>
        </section>

        {/* -------------------------------- why --------------------------------- */}
        <section className="mt-8 max-w-3xl">
          <h2 className="font-semibold tracking-tight text-ink">Why this ladder</h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">{ladder.why}</p>
        </section>

        <nav className="mt-10 flex flex-wrap gap-2 border-t border-hairline pt-5">
          <span className="label mr-2 self-center">Other ladders</span>
          {LADDERS.filter((l) => l.slug !== ladder.slug).map((l) => (
            <Link
              key={l.slug}
              href={`/ladder/${l.slug}`}
              className="rounded-[7px] border border-hairline bg-panel px-2.5 py-1.5 font-mono text-[0.68rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2"
            >
              {l.name}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
