import type { PublicDeveloper, PublicPartner, PublicPricingPlan, PublicShowcaseItem } from '@/lib/content/types';
import type { HomeContent } from '@/lib/home-content';

/**
 * SAMPLE records for /dev/home, in development only (docs/CONTRACT.md 1: sample content
 * exists only in previews and tests, never in shipped pages). They let every station and
 * every record count be looked at before the admin has any published content.
 */
const NAMES = ['Asha', 'Ben', 'Chitra', 'Dev', 'Esha', 'Farid', 'Gita', 'Hari'];
const SERVICE = { slug: 'web-apps', title: 'Web apps' };

export function sampleHome({ projects, plans, people, partners }: { projects: number; plans: number; people: number; partners: number }): HomeContent {
  const projectList: PublicShowcaseItem[] = Array.from({ length: projects }, (_, i) => ({
    slug: `sample-project-${i}`,
    title: `Sample project ${String.fromCharCode(65 + i)}`,
    clientDisplayName: i % 2 === 0 ? 'Sample client' : null,
    summary: 'A sample summary for layout only. The real text is entered in the admin panel when a project is published.',
    body: { brief: null, built: null, result: null },
    services: [SERVICE],
    stack: ['Next.js', 'MongoDB'],
    cover: null,
    gallery: [],
    liveUrl: i === 0 ? 'https://example.com' : null,
    completedOn: null,
    publishedAt: null,
  }));
  const sizes = ['Small', 'Medium', 'Large', 'Custom'];
  const planList: PublicPricingPlan[] = Array.from({ length: plans }, (_, i) => ({
    key: `sample-plan-${i}`,
    name: `Sample ${sizes[i] ?? 'plan'}`,
    summary: 'Who this plan suits, as typed in the admin.',
    priceModel: i === 3 ? 'quote' : 'fixed_from',
    price: i === 3 ? null : { amountMinor: (i + 1) * 100000, currency: 'INR' },
    priceNote: null,
    features: ['First sample feature', 'Second sample feature'],
    highlighted: i === 1,
    ctaLabel: null,
  }));
  const peopleList: PublicDeveloper[] = Array.from({ length: people }, (_, i) => ({
    key: `sample-dev-${i}`,
    displayName: `${NAMES[i % NAMES.length]} Sample`,
    title: 'Developer',
    photo: null,
    bio: 'A sample bio of up to two lines, entered by the developer in the admin panel.',
    skills: ['TypeScript', 'React'],
    links: { github: i === 0 ? 'https://example.com' : null, linkedin: null, website: null },
  }));
  const partnerList: PublicPartner[] = Array.from({ length: partners }, (_, i) => ({
    key: `sample-partner-${i}`,
    name: `Sample partner ${String.fromCharCode(65 + i)}`,
    kind: 'technology',
    logo: null,
    url: null,
  }));
  return { partners: partnerList, projects: projectList, plans: planList, people: peopleList, site: { displayName: 'ProDevly', legalName: null, email: 'hello@example.com', phone: null, whatsapp: null, address: null, social: {}, footerNote: null } };
}
