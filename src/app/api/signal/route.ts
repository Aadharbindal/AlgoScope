import { NextRequest, NextResponse } from 'next/server';
import { ALGORITHMS } from '@/lib/algorithms';
import { signalStore } from '@/lib/signals/store';
import { parseSignal } from '@/lib/signals/types';

/**
 * Ingest for reading-session summaries.
 *
 * Deliberately dull. It accepts one small JSON object, validates every field
 * against the algorithm it claims to describe, appends it, and returns 204 —
 * no reply body, nothing to read back, nothing to enumerate. A malformed
 * signal is dropped rather than repaired: the whole value of this log is that
 * it contains only things that actually happened.
 *
 * What this route never does: read an IP, set a cookie, look at the referrer,
 * or accept free text. There is nothing here to join to a person.
 */

export const runtime = 'nodejs';

const MAX_BODY = 64 * 1024;

const slugs = new Set(ALGORITHMS.map((a) => a.slug));

export async function POST(req: NextRequest) {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) {
    return new NextResponse(null, { status: 413 });
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const signal = parseSignal(raw, slugs);
  if (!signal) return new NextResponse(null, { status: 400 });

  await signalStore.append(signal);
  return new NextResponse(null, { status: 204 });
}
