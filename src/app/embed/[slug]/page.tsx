import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmbedPlayer } from '@/components/EmbedPlayer';
import { ALGORITHMS, bySlug } from '@/lib/algorithms';

/**
 * The embeddable player.
 *
 * A separate route rather than a mode of the workbench, for one reason: what
 * an embed may do is a smaller set than what a page may do, and that is easier
 * to keep true when it is a different file than when it is a flag. There is no
 * navigation out except one explicit link, no recording of reading sessions
 * (the reader never agreed to anything on this site, and did not choose to be
 * here), and nothing that writes to storage the host page shares.
 */

export function generateStaticParams() {
  return ALGORITHMS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata(props: PageProps<'/embed/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const def = bySlug(slug);
  return {
    title: def ? `${def.name} — AlgoScope` : 'AlgoScope',
    // An embed is reached through its host page; it should never be the thing
    // a search engine returns.
    robots: { index: false, follow: false },
  };
}

export default async function EmbedPage(props: PageProps<'/embed/[slug]'>) {
  const { slug } = await props.params;
  if (!bySlug(slug)) notFound();

  const raw = await props.searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') params[k] = v;
    else if (Array.isArray(v) && v[0] !== undefined) params[k] = v[0];
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden">
      <EmbedPlayer slug={slug} params={params} />
    </div>
  );
}
