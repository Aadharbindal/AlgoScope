import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { bySlug } from '@/lib/algorithms';
import { asSet, buildTrace, LANG_LABEL } from '@/lib/algorithms/types';
import { decodeShare } from '@/lib/share/link';
import { resolveLens, ResolvedPointer, ResolvedRegion } from '@/lib/trace/lens';

/**
 * The preview card for a shared link.
 *
 * Distribution for this audience happens in a WhatsApp group, and a link with
 * no card is a link nobody opens. So the card shows the actual step the link
 * points at: the array as it stood, the pointers where they were, and the
 * sentence the player would have narrated.
 *
 * It is built by running the algorithm, exactly as the page does — the same
 * `buildTrace` and the same lens. That matters more than it sounds: a card
 * drawn from a template, or from a model's idea of what binary search looks
 * like, would be a picture of something that never happened, shared to a
 * hundred people who cannot check it.
 */

export const runtime = 'nodejs';

const W = 1200;
const H = 630;

const C = {
  ground: '#0b0f0d',
  panel: '#121815',
  raised: '#19211d',
  hairline: '#1e2723',
  hairlineStrong: '#2b3630',
  ink: '#e4ede7',
  ink2: '#b9c5be',
  muted: '#78877f',
  faint: '#4d5a54',
  accent: '#3ddc97',
  accentDim: '#1a3b2d',
  accentEdge: '#2a6b50',
  onAccent: '#04120c',
  probe: '#f2a93b',
  probeDim: '#3a2c11',
  probeEdge: '#7a5a1c',
  eliminated: '#222b27',
  eliminatedInk: '#56635c',
  danger: '#ff7d6e',
  dangerEdge: '#7d3830',
  info: '#7fb0ff',
};

const REGION_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  eliminated: { bg: C.eliminated, border: C.hairline, color: C.eliminatedInk },
  active: { bg: C.raised, border: C.hairlineStrong, color: C.ink },
  sorted: { bg: C.accentDim, border: C.accentEdge, color: C.ink },
  considering: { bg: C.raised, border: C.probeEdge, color: C.ink },
  found: { bg: C.accent, border: C.accent, color: C.onAccent },
};

const POINTER_COLOR: Record<string, string> = {
  'window-start': C.accent,
  'window-end': C.accent,
  probe: C.probe,
  cursor: C.info,
  runner: C.probe,
  boundary: C.muted,
  aux: C.muted,
};

/** Innermost declared region wins, matching what the page draws. */
function regionFor(regions: ResolvedRegion[], index: number): string | null {
  let kind: string | null = null;
  for (const r of regions) {
    if (index >= r.from && index <= r.to) kind = r.kind;
  }
  return kind;
}

function fallback(message: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: C.ground,
          color: C.ink,
        }}
      >
        <div style={{ fontSize: 30, color: C.accent, letterSpacing: 2 }}>ALGOSCOPE</div>
        <div style={{ fontSize: 56, marginTop: 16 }}>{message}</div>
      </div>
    ),
    { width: W, height: H },
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const def = bySlug(q.get('slug') ?? '');
  if (!def) return fallback('Algorithm not found');

  const share = decodeShare(def, q);

  let trace;
  try {
    trace = buildTrace(def, share.input, asSet(share.mutations));
  } catch {
    return fallback(def.name);
  }
  if (trace.steps.length === 0) return fallback(def.name);

  const at = Math.min(share.step, trace.steps.length - 1);
  const step = trace.steps[at];
  const view = resolveLens(def.lens, step, trace.oracle);

  const struct = step.structs.arr;
  const values = struct?.kind === 'array' ? struct.values : [];
  // Beyond this the cells stop being readable at card size; say so rather
  // than shrinking them into a grey stripe.
  const shown = values.slice(0, 18);
  const clipped = values.length - shown.length;

  const cell = Math.min(64, Math.floor((W - 160) / Math.max(1, shown.length)) - 10);
  const broken = share.mutations.length > 0;

  // A card for a broken variant should show that it is broken, and the only
  // honest way to say so is to run the correct version on the same input and
  // print what it returned. Nothing here is asserted — both numbers came from
  // an execution.
  let correct: string | null = null;
  if (broken) {
    try {
      const reference = buildTrace(def, share.input);
      if (String(reference.result) !== String(trace.result)) {
        correct = String(reference.result);
      }
    } catch {
      /* no comparison rather than a guessed one */
    }
  }

  const pointersAt = (i: number): ResolvedPointer[] => view.pointers.filter((p) => p.index === i);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: C.ground,
          color: C.ink,
          padding: '56px 64px',
        }}
      >
        {/* ------------------------------- head ------------------------------- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: C.accent,
              display: 'flex',
            }}
          />
          <div style={{ fontSize: 22, letterSpacing: 3, color: C.muted }}>ALGOSCOPE</div>
          <div style={{ fontSize: 22, color: C.faint }}>·</div>
          <div style={{ fontSize: 22, color: C.muted }}>{LANG_LABEL[share.lang]}</div>
          {broken && (
            <div
              style={{
                display: 'flex',
                marginLeft: 'auto',
                padding: '6px 14px',
                borderRadius: 8,
                border: `1px solid ${C.dangerEdge}`,
                color: C.danger,
                fontSize: 20,
              }}
            >
              broken variant · {share.mutations.join(' + ')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', fontSize: 52, marginTop: 22, color: C.ink }}>
          {def.name}
        </div>

        {/* ------------------------------ the array --------------------------- */}
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            marginBottom: 'auto',
            paddingTop: 44,
            paddingBottom: 30,
            alignItems: 'flex-end',
            gap: 10,
          }}
        >
          {shown.map((v, i) => {
            const kind = regionFor(view.regions, i);
            const style = (kind && REGION_STYLE[kind]) || {
              bg: C.panel,
              border: C.hairline,
              color: C.ink2,
            };
            const ps = pointersAt(i);
            return (
              <div
                key={i}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
              >
                {/* Pointer names sit above the cell they name; no legend to read. */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: 46,
                    justifyContent: 'flex-end',
                    gap: 2,
                  }}
                >
                  {ps.slice(0, 2).map((p) => (
                    <div
                      key={p.name}
                      style={{
                        display: 'flex',
                        fontSize: 18,
                        color: POINTER_COLOR[p.role] ?? C.muted,
                      }}
                    >
                      {p.name}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: 'flex',
                    width: cell,
                    height: cell,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: style.bg,
                    border: `2px solid ${ps.length ? (POINTER_COLOR[ps[0].role] ?? style.border) : style.border}`,
                    color: style.color,
                    fontSize: Math.min(28, cell - 22),
                  }}
                >
                  {String(v)}
                </div>
                <div style={{ display: 'flex', fontSize: 15, color: C.faint }}>{i}</div>
              </div>
            );
          })}
          {clipped > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: cell,
                marginBottom: 25,
                color: C.faint,
                fontSize: 22,
              }}
            >
              +{clipped} more
            </div>
          )}
        </div>

        {/* ------------------------------ narration --------------------------- */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderTop: `1px solid ${C.hairline}`,
            paddingTop: 26,
          }}
        >
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                padding: '4px 12px',
                borderRadius: 6,
                background: C.raised,
                border: `1px solid ${C.hairlineStrong}`,
                color: C.muted,
                fontSize: 19,
              }}
            >
              step {at + 1} of {trace.steps.length}
            </div>
            <div style={{ display: 'flex', color: C.faint, fontSize: 19 }}>line {step.line}</div>
            {step.invariantHolds === false && (
              <div style={{ display: 'flex', color: C.danger, fontSize: 19 }}>
                invariant broken here
              </div>
            )}
          </div>
          <div style={{ display: 'flex', fontSize: 27, color: C.ink2, lineHeight: 1.35 }}>
            {step.narration.length > 150 ? `${step.narration.slice(0, 147)}…` : step.narration}
          </div>
          {correct !== null && (
            <div style={{ display: 'flex', gap: 12, fontSize: 24, marginTop: 2 }}>
              <span style={{ color: C.danger }}>this run: {String(trace.result)}</span>
              <span style={{ color: C.faint }}>·</span>
              <span style={{ color: C.accent }}>correct: {correct}</span>
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // The card is a pure function of the URL, so it can be cached hard —
        // which is what keeps a link pasted into a big group from re-rendering
        // the trace once per recipient.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
