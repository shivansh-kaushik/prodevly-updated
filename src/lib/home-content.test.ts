import { describe, expect, it } from 'vitest';
import { EMPTY_HOME, sectionsOf, stageDataOf, type HomeContent } from '@/lib/home-content';
import type { PublicDeveloper, PublicPricingPlan, PublicShowcaseItem } from '@/lib/content/types';

const person = (displayName: string): PublicDeveloper => ({ key: displayName, displayName, title: null, photo: null, bio: null, skills: [], links: { github: null, linkedin: null, website: null } });

describe('home content', () => {
  it('hides every data section when nothing is published', () => {
    expect(sectionsOf(EMPTY_HOME)).toEqual({ work: false, pricing: false, team: false });
    expect(stageDataOf(EMPTY_HOME)).toEqual({ projects: 0, plans: 0, people: [] });
  });

  it('tells the stage how many pieces to draw and which initials to print', () => {
    const content: HomeContent = {
      ...EMPTY_HOME,
      projects: [{}, {}] as PublicShowcaseItem[],
      plans: [{}] as PublicPricingPlan[],
      people: [person('asha'), person('Ben')],
    };
    expect(sectionsOf(content)).toEqual({ work: true, pricing: true, team: true });
    expect(stageDataOf(content)).toEqual({ projects: 2, plans: 1, people: ['A', 'B'] });
  });
});
