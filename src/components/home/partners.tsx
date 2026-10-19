import { PARTNERS_SECTION } from '@/content/home';
import type { PublicPartner } from '@/lib/content/types';
import { Section } from '@/components/home/station';

/**
 * One band of partner logos in the section's ink colour (a CSS mask), each with its
 * name as text. It has no station: the totem travels while it passes. With no
 * published partners it renders nothing, not even a heading (docs/CONTRACT.md 1).
 */
export function Partners({ partners }: { partners: PublicPartner[] }) {
  if (partners.length === 0) return null;
  return (
    <Section id="partners" field="graphite" className="py-8">
      <h2 className="pd-kicker">{PARTNERS_SECTION.title}</h2>
      <ul className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-5">
        {partners.map((p) => {
          const inner = p.logo ? (
            <span
              role="img"
              aria-label={p.name}
              className="block h-8 w-28 bg-current"
              style={{ maskImage: `url(${p.logo.url})`, maskRepeat: 'no-repeat', maskPosition: 'left center', maskSize: 'contain', WebkitMaskImage: `url(${p.logo.url})`, WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'left center', WebkitMaskSize: 'contain' }}
            />
          ) : (
            <span className="pd-display text-lg">{p.name}</span>
          );
          return <li key={p.key}>{p.url ? <a href={p.url} rel="noopener noreferrer" target="_blank">{inner}</a> : inner}</li>;
        })}
      </ul>
    </Section>
  );
}
