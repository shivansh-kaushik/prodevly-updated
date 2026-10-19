import { ContactForm } from '@/components/home/contact-form';
import { Section, Zone } from '@/components/home/station';
import { CONTACT, SERVICES } from '@/content/home';
import type { PublicPricingPlan, PublicSiteInfo } from '@/lib/content/types';

/**
 * Contact: the giant Enter key stands in its zone (above the form on a phone, to the
 * right on desktop) and presses when an enquiry is sent. The form is dark, never over 3D.
 */
export function Contact({ plans, site }: { plans: PublicPricingPlan[]; site: PublicSiteInfo | null }) {
  return (
    <Section
      id="contact"
      field="graphite"
      station="contact"
      className="grid gap-3 pb-10 pt-[4.5rem] [grid-template-areas:'head'_'zone'_'form'] pd-split:min-h-svh pd-split:grid-cols-[5fr_7fr] pd-split:content-center pd-split:gap-x-10 pd-split:[grid-template-areas:'head_zone'_'form_zone']"
    >
      <div className="pd-halo [grid-area:head]">
        <p className="pd-kicker">{CONTACT.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.9rem)] pd-split:text-[clamp(2.2rem,3.9vw,3.8rem)]">{CONTACT.title}</h2>
        <p className="mt-3 max-w-[30rem] text-base leading-relaxed pd-split:text-lg">{CONTACT.lede}</p>
      </div>
      <Zone station="contact" className="[grid-area:zone] !min-h-[22svh]" />
      <div className="[grid-area:form]">
        <ContactForm plans={plans.map((p) => ({ key: p.key, name: p.name }))} email={site?.email ?? null} types={SERVICES.map((s) => s.name)} />
        <div className="mt-10">
          <h3 className="pd-display text-xl">{CONTACT.nextTitle}</h3>
          <ol className="mt-4 grid gap-3 text-base leading-relaxed">
            {CONTACT.next.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span aria-hidden="true" className="pd-mono text-mint">
                  0{i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
