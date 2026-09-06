import { NextRequest, NextResponse } from 'next/server';
import { bySlug } from '@/lib/algorithms';
import { decodeShare, encodeShare } from '@/lib/share/link';
import { absolute, siteOrigin } from '@/lib/share/site';

/**
 * oEmbed.
 *
 * This is what makes a pasted AlgoScope link turn into a running player inside
 * WordPress, Notion, Ghost, Confluence and the rest, with nobody copying an
 * iframe snippet. A teacher pastes the URL into their notes and the algorithm
 * appears; that is the whole feature.
 *
 * Only this site's own algorithm URLs are answered. An oEmbed endpoint that
 * echoes back whatever URL it is handed is a redirect gadget, and worse, a way
 * to get arbitrary HTML rendered inside a third-party page under this site's
 * name.
 */

export const runtime = 'nodejs';

const DEFAULT_W = 760;
const DEFAULT_H = 560;
const MIN = 240;
const MAX = 4000;

const clampSize = (raw: string | null, fallback: number) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX, Math.max(MIN, Math.round(n)));
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const raw = q.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const format = q.get('format') ?? 'json';
  if (format !== 'json') {
    // XML is part of the spec and nothing this site talks to asks for it;
    // saying so beats emitting a second serialisation nobody exercises.
    return NextResponse.json({ error: 'only format=json is supported' }, { status: 501 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'url is not a URL' }, { status: 400 });
  }

  const origin = siteOrigin();
  let sameSite = false;
  try {
    sameSite = target.origin === new URL(origin).origin;
  } catch {
    sameSite = false;
  }
  // In development the configured origin and the request's own host often
  // differ; trust the request's host as well, but never anything beyond it.
  if (!sameSite) sameSite = target.origin === req.nextUrl.origin;
  if (!sameSite) {
    return NextResponse.json({ error: 'not a URL on this site' }, { status: 404 });
  }

  const match = /^\/a\/([a-z0-9-]+)\/?$/.exec(target.pathname);
  const def = match ? bySlug(match[1]) : null;
  if (!def) {
    return NextResponse.json({ error: 'not an algorithm page' }, { status: 404 });
  }

  const width = clampSize(q.get('maxwidth'), DEFAULT_W);
  const height = clampSize(q.get('maxheight'), DEFAULT_H);

  // Rebuild the link through the shared codec, so the frame can only ever
  // carry parameters this site defines and has validated.
  const share = decodeShare(def, target.searchParams);
  const src = absolute(`/embed/${def.slug}?${encodeShare(share, def.fields).toString()}`);

  const html =
    `<iframe src="${src}" width="${width}" height="${height}" ` +
    `style="border:1px solid #2b3630;border-radius:12px;max-width:100%" ` +
    `loading="lazy" title="${def.name} — AlgoScope" ` +
    `allowfullscreen></iframe>`;

  return NextResponse.json(
    {
      version: '1.0',
      type: 'rich',
      provider_name: 'AlgoScope',
      provider_url: origin,
      title: `${def.name} — AlgoScope`,
      html,
      width,
      height,
      thumbnail_url: absolute(
        `/api/og?slug=${def.slug}&${encodeShare(share, def.fields).toString()}`,
      ),
      thumbnail_width: 1200,
      thumbnail_height: 630,
    },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
