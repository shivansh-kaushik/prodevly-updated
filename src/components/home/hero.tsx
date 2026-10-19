import { ArrowGlyph } from '@/components/home/key';
import { Section, Zone } from '@/components/home/station';
import { HERO } from '@/content/home';

/**
 * Phone first: the headline in the top third, the totem in the middle, the action
 * as a full-width key at the bottom. Desktop: copy on the left, the totem right.
 * The H1 is in the server HTML and paints in the first frame (no entrance).
 */
export function Hero({ hasWork }: { hasWork: boolean }) {
  return (
    <Section
      id="top"
      field="cobalt"
      station="hero"
      className="grid min-h-svh grid-rows-[auto_1fr_auto] gap-3 pb-6 pt-[4.5rem] [grid-template-areas:'copy'_'zone'_'cta'] pd-split:grid-cols-[6fr_7fr] pd-split:grid-rows-[1fr_auto_auto_1fr] pd-split:gap-x-8 pd-split:pb-10 pd-split:[grid-template-areas:'._zone'_'copy_zone'_'cta_zone'_'._zone']"
    >
      <div className="pd-halo [grid-area:copy]">
        <p className="pd-kicker">{HERO.eyebrow}</p>
        <h1 className="pd-display mt-3 text-[clamp(2rem,9.2vw,2.9rem)] pd-split:text-[clamp(2.4rem,4.1vw,4.3rem)]">{HERO.title}</h1>
        <p className="mt-5 hidden max-w-[30rem] text-lg leading-relaxed opacity-95 pd-split:block">{HERO.lede}</p>
      </div>
      <Zone station="hero" eager className="[grid-area:zone]" />
      <div className="[grid-area:cta]">
        <a href="#contact" className="pd-key w-full text-base pd-split:w-auto pd-split:text-lg" style={{ padding: '1em 1.8em' }}>
          <span>{HERO.cta}</span>
          <ArrowGlyph />
        </a>
        <p className="mt-5 hidden items-center gap-3 text-sm pointer-fine:pd-split:flex">
          <kbd className="inline-grid size-7 place-items-center rounded-md bg-chalk font-sans text-xs font-semibold text-graphite shadow-[inset_0_-2px_0_var(--color-chalk-side)]" aria-hidden="true">
            A
          </kbd>
          <span className="pd-mono">Type on your keyboard. The keys press back.</span>
        </p>
        <p className="mt-4 hidden pd-split:block">
          <a href={hasWork ? '#work' : '#services'} className="pd-mono text-sm underline underline-offset-4">
            {hasWork ? HERO.secondaryWork : HERO.secondaryServices}
          </a>
        </p>
      </div>
    </Section>
  );
}
