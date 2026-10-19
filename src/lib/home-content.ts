import type {
  PublicDeveloper,
  PublicPartner,
  PublicPricingPlan,
  PublicShowcaseItem,
  PublicSiteInfo,
} from '@/lib/content/types';
import { initialOf, type StageData } from '@/lib/stage-data';

/**
 * What the home page renders from the admin-managed records. A section whose list
 * is empty renders nothing, and its nav key and its 3D station go with it
 * (docs/CONTRACT.md section 1), so the DOM and the stage always agree.
 */
export interface HomeContent {
  partners: PublicPartner[];
  projects: PublicShowcaseItem[];
  plans: PublicPricingPlan[];
  people: PublicDeveloper[];
  site: PublicSiteInfo | null;
}

export const EMPTY_HOME: HomeContent = { partners: [], projects: [], plans: [], people: [], site: null };

/** What the stage needs from the records: how many pieces, and the initials of the people. */
export function stageDataOf(content: HomeContent): StageData {
  return {
    projects: content.projects.length,
    plans: content.plans.length,
    people: content.people.map((p) => initialOf(p.displayName)),
  };
}

/** The stations (and nav keys) that will render, in page order. */
export function sectionsOf(content: HomeContent) {
  return {
    work: content.projects.length > 0,
    pricing: content.plans.length > 0,
    team: content.people.length > 0,
  };
}
