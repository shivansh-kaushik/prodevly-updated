import { Audiences } from '@/components/home/audiences';
import { Contact } from '@/components/home/contact';
import { Faq } from '@/components/home/faq';
import { Footer } from '@/components/home/footer';
import { Hero } from '@/components/home/hero';
import { Nav, type NavKey } from '@/components/home/nav';
import { Partners } from '@/components/home/partners';
import { Pricing } from '@/components/home/pricing';
import { Process } from '@/components/home/process';
import { Services } from '@/components/home/services';
import { Team } from '@/components/home/team';
import { Work } from '@/components/home/work';
import { StageMount } from '@/components/site/stage-mount';
import { FOOTER } from '@/content/home';
import { type HomeContent, sectionsOf, stageDataOf } from '@/lib/home-content';

/**
 * The Keycap Colorway home page, as a company portfolio (docs/plan/portfolio.md):
 * hero, partners, work, services, how we work, who we work with, pricing, team,
 * questions, contact. A section with no published records renders
 * nothing, and its nav key and 3D station go with it, because the stage reads the
 * rendered `[data-chapter]` zones and the nav is built from the same list.
 */
export function Home({ content }: { content: HomeContent }) {
  const has = sectionsOf(content);
  // Work leads: visitors believe what they see before what they read.
  const keys: NavKey[] = [...(has.work ? (['work'] as const) : []), 'services', ...(has.pricing ? (['pricing'] as const) : []), ...(has.team ? (['team'] as const) : []), 'contact'];
  return (
    <>
      <a href="#main" className="absolute left-2 top-2 z-50 -translate-y-20 rounded bg-chalk px-3 py-2 text-sm text-graphite focus:translate-y-0">
        {FOOTER.skip}
      </a>
      <Nav keys={keys} />
      <main id="main">
        <Hero hasWork={has.work} />
        <Partners partners={content.partners} />
        {has.work ? <Work projects={content.projects} /> : null}
        <Services />
        <Process />
        <Audiences />
        {has.pricing ? <Pricing plans={content.plans} /> : null}
        {has.team ? <Team people={content.people} /> : null}
        <Faq />
        <Contact plans={content.plans} site={content.site} />
      </main>
      <Footer keys={keys} site={content.site} />
      <StageMount direction="keycap" data={stageDataOf(content)} />
    </>
  );
}
