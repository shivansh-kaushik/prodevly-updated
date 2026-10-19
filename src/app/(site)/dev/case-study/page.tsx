import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CaseStudy } from '@/components/home/case-study';
import type { PublicShowcaseItem } from '@/lib/content/types';

/**
 * /dev/case-study: the case study page with a SAMPLE record, in development only (sample
 * content never ships, docs/CONTRACT.md 1). `?empty=1` leaves the optional parts empty.
 */
export const metadata: Metadata = { title: 'Case study (sample record)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DevCaseStudyPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_STAGE_DEV !== '1') notFound();
  const empty = (await searchParams).empty === '1';
  const item: PublicShowcaseItem = {
    slug: 'sample-project',
    title: 'Sample project A',
    clientDisplayName: empty ? null : 'Sample client',
    summary: 'A sample summary for layout only. The real text is entered in the admin panel when a project is published.',
    body: {
      brief: 'A sample brief: what the client came with and what had to be true at the end.\n\nA second paragraph, to show the spacing between paragraphs.',
      built: empty ? null : 'A sample description of what was built, written by the team in the admin panel.',
      result: empty ? null : 'A sample result, in the words the client approved.',
    },
    services: [{ slug: 'web-apps', title: 'Web apps' }, { slug: 'ui-ux-design', title: 'UI/UX design' }],
    stack: empty ? [] : ['Next.js', 'MongoDB'],
    cover: null,
    gallery: [],
    liveUrl: empty ? null : 'https://example.com',
    completedOn: empty ? null : '2026-08-01',
    publishedAt: null,
  };
  return <CaseStudy item={item} next={empty ? null : { slug: 'sample-project-b', title: 'Sample project B' }} site={null} />;
}
