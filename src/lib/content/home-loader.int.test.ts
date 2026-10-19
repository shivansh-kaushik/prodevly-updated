import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb } from '@/test/db';
import { makeDeveloper, makePartner, makePlan, makeShowcase } from '@/test/content-factories';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));

import { loadCaseStudy, loadCaseStudySlugs, loadHomeContent } from '@/lib/content/home-loader';
import { sectionsOf, stageDataOf } from '@/lib/home-content';

setupTestDb();

describe('the home page loader', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows what is published in the admin, and nothing else', async () => {
    await makeShowcase({ title: 'Live project', published: true });
    await makeShowcase({ title: 'Draft project' });
    await makePlan({ name: 'Live plan', published: true });
    await makeDeveloper({ displayName: 'asha dev', published: true });
    await makeDeveloper({ displayName: 'Draft dev' });
    await makePartner({ name: 'Live partner', published: true });

    const home = await loadHomeContent();
    expect(home.projects.map((p) => p.title)).toEqual(['Live project']);
    expect(home.plans.map((p) => p.name)).toEqual(['Live plan']);
    expect(home.people.map((p) => p.displayName)).toEqual(['asha dev']);
    expect(home.partners.map((p) => p.name)).toEqual(['Live partner']);
    expect(sectionsOf(home)).toEqual({ work: true, pricing: true, team: true });
    expect(stageDataOf(home)).toEqual({ projects: 1, plans: 1, people: ['A'] });
  });

  it('hides every data section while nothing is published', async () => {
    await makeShowcase({ title: 'Draft project' });
    expect(sectionsOf(await loadHomeContent())).toEqual({ work: false, pricing: false, team: false });
  });

  it('renders the static page when no database is configured', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const home = await loadHomeContent();
    expect(home.projects).toEqual([]);
    expect(home.site).toBeNull();
  });
});

describe('the case study loader', () => {
  it('returns a published project with the next one, wrapping around', async () => {
    await makeShowcase({ title: 'First', slug: 'first', published: true });
    await makeShowcase({ title: 'Second', slug: 'second', published: true });
    await makeShowcase({ title: 'Hidden', slug: 'hidden' });
    const first = await loadCaseStudy('first');
    expect(first?.item.title).toBe('First');
    expect(first?.next?.slug).toBe('second');
    expect((await loadCaseStudy('second'))?.next?.slug).toBe('first');
  });

  it('returns nothing for a draft, an unknown or a malformed slug', async () => {
    await makeShowcase({ title: 'Hidden', slug: 'hidden' });
    expect(await loadCaseStudy('hidden')).toBeNull();
    expect(await loadCaseStudy('nope')).toBeNull();
    expect(await loadCaseStudy('../etc')).toBeNull();
  });

  it('has no next project when there is only one', async () => {
    await makeShowcase({ title: 'Only', slug: 'only', published: true });
    expect((await loadCaseStudy('only'))?.next).toBeNull();
  });

  it('lists the published slugs to prerender', async () => {
    await makeShowcase({ title: 'A', slug: 'a-one', published: true });
    await makeShowcase({ title: 'B', slug: 'b-two' });
    expect(await loadCaseStudySlugs()).toEqual(['a-one']);
  });
});
