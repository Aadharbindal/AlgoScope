import Link from 'next/link';
import { Backdrop } from '@/components/site/Backdrop';
import { HeroDemo } from '@/components/site/HeroDemo';
import {
  ArrowRightIcon,
  BulbIcon,
  CheckIcon,
  PlayIcon,
  TargetIcon,
  TerminalIcon,
} from '@/components/site/Icons';
import { SiteHeader } from '@/components/site/SiteHeader';
import { LADDERS } from '@/lib/ladders';
import { grouped } from '@/lib/algorithms';

const PROMISES = [
  'Run your code',
  'Step by step state',
  'Find the exact bug',
];

const CLAIMS = [
  {
    icon: TerminalIcon,
    title: 'It runs. It does not narrate.',
    body: 'Every number on screen came out of an instrumented run. The picture is generated from the trace, so it cannot drift from what the code did — and no model is allowed to invent one.',
  },
  {
    icon: BulbIcon,
    title: 'It asks you questions.',
    body: 'At the steps that carry the concept, it stops and asks what you think happens next. A video cannot mark your answer. That difference is most of the learning.',
  },
  {
    icon: TargetIcon,
    title: 'It finds where you went wrong.',
    body: 'Run a broken version beside a correct one on the same input, compare the traces, and land on the exact point of divergence. Computed, not guessed.',
  },
];

const HONESTY = [
  {
    lead: 'It does not guess complexity from your source.',
    body: 'It re-runs the algorithm at increasing input sizes, counts operations, and fits the curve to what actually happened.',
  },
  {
    lead: 'It does not let a model draw the animation.',
    body: 'The picture is a rendering of the trace. Remove every AI feature and the tool still works — that is the test the design has to pass.',
  },
  {
    lead: 'It does not show a view it cannot verify.',
    body: 'Each algorithm carries an invariant, checked against a known-correct run before the interpretation is allowed on screen.',
  },
];

export default function Home() {
  const groups = grouped();

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div className="bg-instrument" aria-hidden />
      <Backdrop />

      <SiteHeader />

      <main className="relative z-10 mx-auto w-full max-w-[1180px] flex-1 px-5 sm:px-8">
        {/* ------------------------------- hero ------------------------------ */}
        {/* The hero owns the first screen. Fixed padding cannot do this — it
            leaves the next band half-peeking on one screen height and a dead
            gap on another — so on wide viewports the section spans what is
            left below the header and centres itself in it. The cards then
            begin exactly at the fold, whatever the window height. */}
        <section id="demo" className="scroll-mt-24 grid items-center gap-9 pb-14 pt-4 sm:pb-16 sm:pt-6 lg:min-h-[calc(100svh-4.5rem)] lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-12 lg:pb-0 lg:pt-0">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-edge bg-accent-dim px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-accent">
              Visualize <span className="opacity-50">›</span> Understand{' '}
              <span className="opacity-50">›</span> Master
            </span>

            <h1 className="mt-5 text-[2.7rem] font-extrabold leading-[1.03] tracking-[-0.035em] text-ink sm:text-[3.15rem]">
              See what your
              <br />
              code <span className="text-accent">actually</span>
              <br />
              does.<span className="caret text-accent">|</span>
            </h1>

            <p className="mt-5 max-w-md text-[0.97rem] leading-relaxed text-muted">
              A video shows you a correct algorithm. A chatbot guesses about yours. This runs the
              code, shows you the state at every step, and tells you the exact moment it stopped
              being correct.
            </p>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/a/binary-search"
                className="inline-flex items-center gap-2 rounded-[5px] bg-accent px-4 py-2.5 text-[0.9rem] font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                <PlayIcon size={13} />
                Start with binary search
                <ArrowRightIcon size={15} />
              </Link>
              <Link
                href="/a/reverse-linked-list?bug=lost-next"
                className="inline-flex items-center rounded-[5px] border border-hairline-strong bg-panel px-4 py-2.5 text-[0.9rem] text-ink-2 transition-colors hover:border-danger-edge hover:text-danger"
              >
                See a bug get located
              </Link>
            </div>

            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-center gap-1.5 text-[0.8rem] text-muted">
                  <CheckIcon size={13} className="text-accent" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <HeroDemo />
        </section>

        {/* ------------------------------- how ------------------------------- */}
        {/* Enough air above that the hero reads as finished before this band
            starts, rather than the cards crowding up under the demo. */}
        <section id="how" className="scroll-mt-20 pb-12 pt-14">
          <div className="grid gap-4 sm:grid-cols-3">
            {CLAIMS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-lg border border-hairline bg-panel p-5 transition-colors hover:border-hairline-strong"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[7px] border border-accent-edge bg-accent-dim text-accent">
                  <Icon size={17} />
                </span>
                <h2 className="mt-3.5 text-[0.95rem] font-semibold tracking-tight text-ink">
                  {title}
                </h2>
                <p className="mt-1.5 text-[0.84rem] leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------- algorithms ---------------------------- */}
        <section id="algorithms" className="scroll-mt-20 border-t border-hairline py-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-ink">Algorithms</h2>
            <p className="font-mono text-[0.7rem] text-faint">
              a small set, each one instrumented properly
            </p>
          </div>

          {/* Ladders first: the question a reader brings is usually "how do I
              solve this", not "show me quick sort". A ladder answers that in
              the order the answer is actually arrived at. */}
          <div className="mt-6 flex flex-col gap-3">
            <h3 className="label">Approach ladders — one problem, every approach, measured</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {LADDERS.map((l) => (
                <Link
                  key={l.slug}
                  href={`/ladder/${l.slug}`}
                  className="group flex flex-col gap-2 rounded-lg border border-hairline bg-panel p-4 transition-colors hover:border-accent-edge"
                >
                  <span className="font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
                    {l.name}
                  </span>
                  <span className="font-mono text-[0.68rem] leading-relaxed text-muted">
                    {l.rungs.map((r) => r.label).join(' → ')}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-9 flex flex-col gap-8">
            {groups.map((g) => (
              <div key={g.category}>
                <h3 className="label mb-3">{g.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((a) => (
                    <Link
                      key={a.slug}
                      href={`/a/${a.slug}`}
                      className="group flex flex-col gap-2 rounded-lg border border-hairline bg-panel p-4 transition-colors hover:border-accent-edge"
                    >
                      <span className="font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
                        {a.name}
                      </span>
                      <span className="text-[0.82rem] leading-snug text-muted">{a.tagline}</span>
                      <span className="mt-auto flex items-center gap-3 pt-2 font-mono text-[0.62rem] text-faint">
                        <span>{a.complexity.time}</span>
                        <span className="ml-auto">
                          {a.variants.length} bug{a.variants.length === 1 ? '' : 's'} to find
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------ about ------------------------------ */}
        <section id="about" className="scroll-mt-20 border-t border-hairline py-12">
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            What this deliberately does not do
          </h2>
          <p className="mt-2 max-w-xl text-[0.92rem] leading-relaxed text-muted">
            An educational tool runs entirely on trust. These are the three places it would have
            been easy to look more capable by being less honest.
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {HONESTY.map((h, i) => (
              <div key={h.lead} className="border-t border-hairline-strong pt-3.5">
                <span className="font-mono text-[0.62rem] text-accent">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="mt-1.5 text-[0.88rem] font-semibold leading-snug text-ink">{h.lead}</p>
                <p className="mt-1.5 text-[0.82rem] leading-relaxed text-muted">{h.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto max-w-[1180px] px-5 py-6 font-mono text-[0.65rem] leading-relaxed text-faint sm:px-8">
          Operation counts are educational, not hardware measurements. Traces are generated in your
          browser — nothing is uploaded.
        </div>
      </footer>
    </div>
  );
}
