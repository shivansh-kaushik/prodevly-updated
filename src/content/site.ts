/**
 * Static site facts. Only things the team has stated live here.
 * No counts, ratings, years in business, awards or client names (see docs/CONTRACT.md):
 * `npm run check:copy` scans this folder.
 */
export const SITE = {
  name: 'ProDevly',
  description: 'ProDevly designs and builds web apps, SaaS products and custom software.',
  services: [
    'Web apps',
    'SaaS products',
    'Custom software',
    'Mobile apps',
    'UI/UX design',
    'Cloud & DevOps',
  ],
} as const;
