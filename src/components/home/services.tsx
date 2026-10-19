import { BoundList } from '@/components/home/bound-list';
import { Section, Zone } from '@/components/home/station';
import { SERVICES, SERVICES_SECTION } from '@/content/home';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * One becomes many: the cairn unstacks into a key cluster, one cap per service.
 * A service tile lifts its cap on hover or focus. Under the station sit the full
 * details, as ordinary page content.
 */
export function Services() {
  return (
    <Section id="services" field="chalk">
      <div
        data-chapter="services"
        className="grid min-h-svh grid-rows-[auto_1fr_auto] gap-3 pb-8 pt-[4.5rem] [grid-template-areas:'head'_'zone'_'keys'] pd-split:grid-cols-[7fr_5fr] pd-split:grid-rows-[1fr_auto_auto_1fr] pd-split:gap-x-8 pd-split:[grid-template-areas:'zone_.'_'zone_head'_'zone_keys'_'zone_.']"
      >
        <div className="pd-halo [grid-area:head]">
          <p className="pd-kicker">{SERVICES_SECTION.eyebrow}</p>
          <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.7rem)] pd-split:text-[clamp(2.2rem,3.6vw,3.6rem)]">{SERVICES_SECTION.title}</h2>
          <p className="mt-3 max-w-[30rem] text-base leading-relaxed pd-split:text-lg">{SERVICES_SECTION.lede}</p>
        </div>
        <Zone station="services" className="[grid-area:zone]" />
        <BoundList field="service" label="Services" className="grid grid-cols-2 gap-2 [grid-area:keys] pd-split:mt-5" itemClassName="min-w-0">
          {SERVICES.map((s) => (
            <a key={s.name} href={`#service-${slug(s.name)}`} className="pd-key pd-key--white w-full !justify-start text-[0.875rem]" style={{ padding: '0.75em 1.15em' }}>
              {s.name}
            </a>
          ))}
        </BoundList>
      </div>

      <div className="pb-20 pt-6">
        <h3 className="pd-display text-[clamp(1.5rem,6vw,2.1rem)]">{SERVICES_SECTION.detailsTitle}</h3>
        <ul className="mt-6 grid gap-3 pd-split:grid-cols-3">
          {SERVICES.map((s) => (
            <li key={s.name} id={`service-${slug(s.name)}`} className="scroll-mt-20 rounded-xl bg-white p-5 shadow-[inset_0_-0.35rem_0_var(--color-chalk-side)]">
              <h4 className="pd-display text-xl">{s.name}</h4>
              <p className="mt-2 text-base leading-relaxed">{s.blurb}</p>
              <ul className="mt-3 grid gap-1 text-sm">
                {s.included.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-sm bg-graphite" />
                    {item}
                  </li>
                ))}
              </ul>
              {s.stack.length > 0 ? (
                <p className="mt-4 flex flex-wrap gap-1.5">
                  {s.stack.map((chip) => (
                    <span key={chip} className="pd-mono rounded bg-graphite px-2 py-1 text-[0.6875rem] uppercase text-yolk">
                      {chip}
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

      </div>
    </Section>
  );
}
