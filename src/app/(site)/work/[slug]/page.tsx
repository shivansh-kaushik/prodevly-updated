import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CaseStudy } from '@/components/home/case-study';
import { loadCaseStudy, loadCaseStudySlugs } from '@/lib/content/home-loader';

/** Static, refreshed hourly and on demand when a project changes; new slugs render on first request. */
export const revalidate = 3600;

type Params = Promise<{ slug: string }>;

export async function generateStaticParams() {
  return (await loadCaseStudySlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const content = await loadCaseStudy((await params).slug);
  if (!content) return {};
  const { item } = content;
  return {
    title: item.title,
    description: item.summary,
    openGraph: { title: item.title, description: item.summary, images: item.cover ? [{ url: item.cover.url, alt: item.cover.alt }] : undefined },
  };
}

export default async function CaseStudyPage({ params }: { params: Params }) {
  const content = await loadCaseStudy((await params).slug);
  if (!content) notFound();
  return <CaseStudy item={content.item} next={content.next} site={content.site} />;
}
