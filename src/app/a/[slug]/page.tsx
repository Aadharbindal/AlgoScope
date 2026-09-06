import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Workbench } from '@/components/Workbench';
import { ALGORITHMS, bySlug } from '@/lib/algorithms';
import { asSet, buildTrace, LANG_LABEL } from '@/lib/algorithms/types';
import { decodeShare, encodeShare } from '@/lib/share/link';
import { absolute } from '@/lib/share/site';

export function generateStaticParams() {
  return ALGORITHMS.map((a) => ({ slug: a.slug }));
}

/**
 * The card a shared link produces.
 *
 * A deep link carries a specific step, so the card describes that step rather
 * than the algorithm in general — pasting "look at what happens on step 14"
 * into a group chat and getting a generic banner back is the same as getting
 * nothing. Reading the query string here is what makes the page render per
 * request rather than once at build; that is the price of the card being true,
 * and the render is a trace of at most a few thousand steps.
 */
export async function generateMetadata(props: PageProps<'/a/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const q = await props.searchParams;
  const def = bySlug(slug);
  if (!def) return { title: 'Not found — AlgoScope' };

  const share = decodeShare(def, q);
  const card = new URLSearchParams(encodeShare(share, def.fields));
  card.set('slug', slug);
  const image = absolute(`/api/og?${card.toString()}`);
  const page = absolute(`/a/${slug}?${encodeShare(share, def.fields).toString()}`);

  // Describe the actual step when the link names one, and say so only if the
  // trace really reaches it.
  let description = `${def.tagline} Step through a real execution, watch the invariant, and find where a broken version diverges.`;
  let title = `${def.name} — AlgoScope`;

  if (share.step > 0 || share.mutations.length > 0) {
    try {
      const trace = buildTrace(def, share.input, asSet(share.mutations));
      const at = Math.min(share.step, trace.steps.length - 1);
      const step = trace.steps[at];
      if (step) {
        const bug = share.mutations.length ? ` · ${share.mutations.join(' + ')}` : '';
        title = `${def.name}, step ${at + 1}${bug} — AlgoScope`;
        description = `${step.narration} — step ${at + 1} of ${trace.steps.length}, line ${step.line}, in ${LANG_LABEL[share.lang]}.`;
      }
    } catch {
      /* an input that will not run keeps the general description */
    }
  }

  return {
    title,
    description,
    alternates: {
      canonical: page,
      types: {
        'application/json+oembed': `${absolute('/api/oembed')}?url=${encodeURIComponent(page)}&format=json`,
      },
    },
    openGraph: {
      title,
      description,
      url: page,
      siteName: 'AlgoScope',
      type: 'article',
      images: [{ url: image, width: 1200, height: 630, alt: `${def.name} at step ${share.step + 1}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function AlgorithmPage(props: PageProps<'/a/[slug]'>) {
  const { slug } = await props.params;
  if (!bySlug(slug)) notFound();
  return <Workbench slug={slug} />;
}
