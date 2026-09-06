/**
 * The ambient field behind the first screen.
 *
 * Two layers, and they answer to different constraints.
 *
 * The field itself — rings, body, arc, bloom — is drawn at every width, because
 * it is what gives the page depth and there is no width at which depth is
 * unwelcome. It sits entirely behind the content and never competes with it.
 *
 * The marginalia — the rail on the left, the words down the right, the line at
 * the bottom — need real gutters, and the content column is 1180px wide. Below
 * roughly 1460px there is no room for them beside the text, so they are not
 * shown at all rather than laid over the copy. That threshold is measured from
 * the layout rather than picked from Tailwind's breakpoints, which is why it is
 * a media query and not a class.
 *
 * The field is masked out towards its foot rather than clipped. A backdrop that
 * simply ends draws a hard horizontal seam across the page — a line nothing in
 * the design put there — so it dissolves before it reaches its own edge, and
 * the box is taller than the fold so the edge itself is never in view. Only the
 * field is faded; the marginalia sit outside the mask and stay legible.
 *
 * The rings are concentric, from a centre off the left edge: a scope's signal
 * rings, which is both what this instrument is named after and a shape that
 * cannot be mistaken for terrain. Contour lines were the obvious thing to draw
 * here and the wrong one — they read as hills, and this page is not about
 * hills.
 */

const RAIL = [
  { label: 'Insight', top: '34%' },
  { label: 'Algorithm', top: '49%' },
  { label: 'Input', top: '61%' },
];

const EDGE_TOP = ['Trace', 'Learn', 'Improve', 'Repeat'];
const EDGE_BOTTOM = ['Better', 'Algorithms', 'Brighter minds'];

export function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[112svh] select-none"
    >
      {/* ---- the field: drawn at every width, dissolved before its own edge -- */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 58%, transparent 92%)',
          maskImage: 'linear-gradient(to bottom, #000 0%, #000 58%, transparent 92%)',
        }}
      >
        {/* Signal rings from a centre off the left edge, fading out before they
            reach the copy. */}
        <div
          className="absolute inset-y-0 left-0 w-[62%]"
          style={{
            background:
              'repeating-radial-gradient(circle at -8% 48%, transparent 0 43px, var(--hairline-strong) 43px 44px)',
            opacity: 0.85,
            WebkitMaskImage:
              'linear-gradient(to right, #000 0%, rgb(0 0 0 / 0.55) 34%, transparent 72%)',
            maskImage: 'linear-gradient(to right, #000 0%, rgb(0 0 0 / 0.55) 34%, transparent 72%)',
          }}
        />

        {/* The bloom the rings sit in. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(46% 52% at 2% 52%, rgb(61 220 151 / 0.10), transparent 68%),' +
              'radial-gradient(40% 38% at 6% 98%, rgb(61 220 151 / 0.09), transparent 70%)',
          }}
        />

        {/* A body low on the right, mostly off canvas so it reads as depth. */}
        <div
          className="absolute rounded-full"
          style={{
            right: '-5.5rem',
            top: '42%',
            width: '19rem',
            height: '19rem',
            background:
              'radial-gradient(circle at 32% 26%, rgb(61 220 151 / 0.15), rgb(61 220 151 / 0.05) 42%, rgb(61 220 151 / 0.015) 66%, transparent 74%)',
            boxShadow:
              'inset 0 0 0 1px rgb(61 220 151 / 0.12), inset -18px -22px 44px rgb(0 0 0 / 0.32)',
          }}
        />

        {/* A hairline arc leaving the top-right corner. */}
        <div
          className="absolute rounded-full border"
          style={{
            right: '-19rem',
            top: '-21rem',
            width: '40rem',
            height: '40rem',
            borderColor: 'var(--hairline-strong)',
          }}
        />
      </div>

      {/* ---- the marginalia: only where there is a gutter to hold them ------- */}
      <div className="backdrop-margins absolute inset-x-0 top-0 h-[100svh]">
        <span
          className="absolute left-[3.4rem] w-px"
          style={{
            top: '30%',
            height: '35%',
            background:
              'linear-gradient(to bottom, transparent, var(--hairline-strong) 18%, var(--hairline-strong) 82%, transparent)',
          }}
        />
        {RAIL.map((r) => (
          <div
            key={r.label}
            className="absolute flex items-center gap-3"
            style={{ left: 'calc(3.4rem - 0.1875rem)', top: r.top, transform: 'translateY(-50%)' }}
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute -inset-[3.5px] rounded-full border border-accent-edge opacity-60" />
              <span className="h-1.5 w-1.5 rounded-full bg-accent opacity-75" />
            </span>
            <span className="whitespace-nowrap font-mono text-[0.56rem] uppercase tracking-[0.2em] text-faint">
              {r.label}
            </span>
          </div>
        ))}

        <div className="absolute right-8 top-[22%] text-right">
          {EDGE_TOP.map((w) => (
            <p
              key={w}
              className="font-mono text-[0.56rem] uppercase leading-[1.9] tracking-[0.2em] text-faint"
            >
              {w}
            </p>
          ))}
        </div>

        <div className="absolute bottom-[7%] right-8 text-right">
          {EDGE_BOTTOM.map((w) => (
            <p
              key={w}
              className="font-mono text-[0.56rem] uppercase leading-[1.9] tracking-[0.2em] text-faint"
            >
              {w}
            </p>
          ))}
        </div>

        <p className="absolute bottom-[7%] left-9 max-w-[12rem] text-[0.78rem] italic leading-relaxed text-faint">
          &ldquo;Bridging the gap between code and intuition.&rdquo;
        </p>
      </div>
    </div>
  );
}
