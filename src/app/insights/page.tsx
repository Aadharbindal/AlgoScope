import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/site/Wordmark';
import { bySlug } from '@/lib/algorithms';
import { buildConfusionGraph, LineInsight, MIN_SESSIONS } from '@/lib/signals/aggregate';
import { signalStore, StoreStatus } from '@/lib/signals/store';

/**
 * The confusion graph, read back.
 *
 * Everything on this page is a count of something that happened. There is no
 * model here, no inferred "learning style", nothing about any individual — the
 * unit is a line of code, and the claim is only ever "readers behaved this way
 * at this line". A rate computed from four sessions is not shown at all,
 * because it would look like knowledge and be noise.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Where readers get stuck — AlgoScope',
  description:
    'Which line of each algorithm readers re-read, sit on, mispredict, and abandon — measured from step-level interaction, aggregated by source line.',
  robots: { index: false },
};

const READ_LIMIT = 20_000;

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function InsightsPage() {
  const [signals, status] = await Promise.all([
    signalStore.read(READ_LIMIT),
    signalStore.status(),
  ]);
  const graph = buildConfusionGraph(signals);

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="bg-instrument" aria-hidden />

      <header className="px-4 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {/* Wordmark is its own link home; wrapping it in another produces
              nested anchors and a hydration error. */}
          <Wordmark size="sm" />
          <span className="h-4 w-px bg-hairline-strong" />
          <h1 className="font-semibold tracking-tight text-ink">Where readers get stuck</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <p className="max-w-2xl text-[0.95rem] leading-relaxed text-muted">
          Every reading session leaves four counts per line: how many times it was re-read, how long
          it was held, whether a predict-then-reveal question about it was answered wrongly, and
          whether the reader stopped there. Aggregated by source line — a step index means something
          only within one input, a line number means the same thing to everyone.
        </p>

        <Provenance status={status} sessions={graph.totalSessions} />

        {graph.algorithms.length === 0 ? (
          <Empty />
        ) : (
          <div className="mt-8 flex flex-col gap-8">
            {graph.algorithms.map((a) => (
              <AlgorithmCard key={a.slug} insight={a} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Provenance({
  status,
  sessions,
}: {
  status: StoreStatus;
  sessions: number;
}) {
  return (
    <div className="mt-6 rounded-xl border border-hairline bg-panel p-4">
      <p className="label">Where these numbers come from</p>
      <dl className="mt-3 grid gap-x-8 gap-y-2 font-mono text-[0.72rem] sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">sessions read back</dt>
          <dd className="text-ink">{sessions.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">sessions stored</dt>
          <dd className="text-ink">{status.rows.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">minimum before a rate is shown</dt>
          <dd className="text-ink">{MIN_SESSIONS} sessions</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">storage</dt>
          <dd className={status.durable ? 'text-accent' : 'text-danger'}>
            {status.durable ? status.where : 'this instance only'}
          </dd>
        </div>
      </dl>
      {!status.durable && (
        <p className="mt-3 text-[0.78rem] leading-snug text-danger">
          Signals are not reaching a durable store, so what you see below covers only this running
          instance and disappears when it restarts. On a serverless host the filesystem is
          ephemeral by design: attach a Redis database and set{' '}
          <span className="font-mono">UPSTASH_REDIS_REST_URL</span> and{' '}
          <span className="font-mono">UPSTASH_REDIS_REST_TOKEN</span>, or point{' '}
          <span className="font-mono">ALGOSCOPE_DATA_DIR</span> at a mounted volume.
        </p>
      )}
      {status.durable && status.capped && (
        <p className="mt-3 text-[0.78rem] leading-snug text-muted">
          The store is at its cap of {status.keeps.toLocaleString()} sessions, so the oldest have
          been dropped. Everything below is the most recent {status.keeps.toLocaleString()}, not
          the whole history &mdash; which is said here rather than left for you to infer from a
          rate that quietly changed.
        </p>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-8 rounded-xl border border-hairline bg-panel p-6">
      <p className="text-[0.95rem] leading-relaxed text-ink">Nothing recorded yet.</p>
      <p className="mt-2 max-w-2xl text-[0.88rem] leading-relaxed text-muted">
        A session is sent once, when the tab is hidden or closed — so open an algorithm, step
        through part of it, and come back. Readers who have turned recording off send nothing at
        all, and this page has no way to know they were here.
      </p>
    </div>
  );
}

function AlgorithmCard({
  insight,
}: {
  insight: ReturnType<typeof buildConfusionGraph>['algorithms'][number];
}) {
  const def = bySlug(insight.slug);
  const source = def?.code.cpp.split('\n') ?? [];

  // Only lines with a score are ranked; the rest are honestly "too few reads".
  const ranked = insight.lines.filter((l) => l.score !== null).slice(0, 8);
  const thin = insight.lines.length - ranked.length;

  return (
    <section className="rounded-xl border border-hairline bg-panel">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="font-semibold tracking-tight text-ink">{def?.name ?? insight.slug}</h2>
        <Link
          href={`/a/${insight.slug}`}
          className="font-mono text-[0.68rem] text-accent hover:underline"
        >
          open
        </Link>
        <span className="ml-auto font-mono text-[0.68rem] text-muted">
          {insight.sessions.toLocaleString()} sessions ·{' '}
          {pct(insight.sessions ? insight.finished / insight.sessions : 0)} reached the end
          {insight.medianDuration !== null && ` · ${insight.medianDuration}s median`}
        </span>
      </div>

      {ranked.length === 0 ? (
        <p className="px-4 py-4 text-[0.85rem] leading-snug text-muted sm:px-5">
          Read {insight.sessions} time{insight.sessions === 1 ? '' : 's'}, which is not yet enough
          for any line to report a rate. Nothing is shown rather than a number computed from a
          handful of visits.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-hairline">
                {['line', 'source', 're-reads', 'held', 'mispredicted', 'stopped here'].map((h) => (
                  <th key={h} className="label px-3 py-2 font-normal first:pl-4 sm:first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((l) => (
                <Row key={l.line} line={l} text={source[l.line - 1] ?? ''} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {thin > 0 && (
        <p className="border-t border-hairline px-4 py-2.5 font-mono text-[0.66rem] text-faint sm:px-5">
          {thin} more line{thin === 1 ? '' : 's'} seen by fewer than {MIN_SESSIONS} sessions —
          reported as unknown rather than estimated.
        </p>
      )}
    </section>
  );
}

function Row({ line, text }: { line: LineInsight; text: string }) {
  // The bar is the blended score; the columns beside it are what produced it,
  // so a high score can always be read back to a reason.
  const width = `${Math.round((line.score ?? 0) * 100)}%`;

  return (
    <tr className="border-b border-hairline/60 last:border-0">
      <td className="relative px-3 py-2 pl-4 font-mono text-[0.7rem] text-muted sm:pl-5">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-danger-dim"
          style={{ width }}
          title={`confusion score ${Math.round((line.score ?? 0) * 100)} of 100`}
        />
        <span className="relative">{line.line}</span>
      </td>
      <td className="max-w-[22rem] truncate px-3 py-2 font-mono text-[0.72rem] text-ink-2">
        {text.trim() || <span className="text-faint">(blank)</span>}
      </td>
      <td className="px-3 py-2 font-mono text-[0.72rem] text-ink">
        {line.reread === null ? <Unknown /> : `${line.reread.toFixed(1)}×`}
      </td>
      <td className="px-3 py-2 font-mono text-[0.72rem] text-ink">
        {line.dwell === null ? <Unknown /> : `${line.dwell}s`}
      </td>
      <td className="px-3 py-2 font-mono text-[0.72rem] text-ink">
        {line.checkpointMiss === null ? (
          <span className="text-faint">
            {line.checkpointAnswers > 0 ? `${line.checkpointAnswers} answers` : '—'}
          </span>
        ) : (
          <span className={line.checkpointMiss > 0.4 ? 'text-danger' : undefined}>
            {pct(line.checkpointMiss)}{' '}
            <span className="text-faint">of {line.checkpointAnswers}</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[0.72rem] text-ink">
        {line.drop === null ? <Unknown /> : pct(line.drop)}
      </td>
    </tr>
  );
}

const Unknown = () => (
  <span className="text-faint" title={`fewer than ${MIN_SESSIONS} sessions reached this line`}>
    —
  </span>
);
