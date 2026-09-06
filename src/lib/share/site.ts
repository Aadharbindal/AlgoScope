/**
 * The site's own absolute origin.
 *
 * Preview cards and oEmbed replies must carry absolute URLs — a crawler has no
 * page to resolve a relative one against. Configure `NEXT_PUBLIC_SITE_URL` in
 * production; the Vercel-provided host is used when it is present, and
 * localhost is the last resort so a dev server still previews correctly.
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** An absolute URL for a path already beginning with a slash. */
export const absolute = (path: string) => `${siteOrigin()}${path}`;
