import type { CSSProperties } from 'react';
import { BoundList } from '@/components/home/bound-list';
import { PlanButton } from '@/components/home/plan-button';
import { Section, Zone } from '@/components/home/station';
import { PRICING_SECTION } from '@/content/home';
import type { PublicPricingPlan } from '@/lib/content/types';
import { priceLine } from '@/lib/price-line';
import { plateSizes } from '@/three/directions/keycap/plates';

/**
 * Pricing: one keyboard plate per plan, growing with plan order. On desktop each card
 * sits under its plate, with columns as wide as the plates, so the biggest plate has
 * the widest card. On a phone the cards are a rail.
 */
export function Pricing({ plans }: { plans: PublicPricingPlan[] }) {
  const columns = plateSizes(plans.length)
    .map((p) => `${p.w}fr`)
    .join(' ');
  return (
    <Section id="pricing" field="mint" station="pricing" className="grid min-h-svh grid-rows-[auto_minmax(20svh,1fr)_auto] gap-3 pb-6 pt-[4.5rem]">
      <div className="pd-halo pd-split:max-w-[40rem]">
        <p className="pd-kicker">{PRICING_SECTION.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.7rem)] pd-split:text-[clamp(2.2rem,3.6vw,3.6rem)]">{PRICING_SECTION.title}</h2>
        <p className="mt-3 text-base leading-relaxed pd-split:text-lg">{PRICING_SECTION.lede}</p>
      </div>
      <Zone station="pricing" />
      <BoundList
        field="plan"
        label="Plans"
        className="pd-rail pd-split:grid pd-split:items-stretch pd-split:overflow-visible pd-split:[grid-template-columns:var(--cols)]"
        itemClassName="min-w-0"
        style={{ '--cols': columns } as CSSProperties}
      >
        {plans.map((p) => (
          <PlanCard key={p.key} plan={p} />
        ))}
      </BoundList>
    </Section>
  );
}

function PlanCard({ plan: p }: { plan: PublicPricingPlan }) {
  const dark = p.highlighted;
  return (
    <article
      className={`flex h-full flex-col rounded-xl p-4 ${dark ? 'bg-graphite text-chalk shadow-[inset_0_-0.4rem_0_var(--color-graphite-side)]' : 'bg-chalk text-graphite shadow-[inset_0_-0.4rem_0_var(--color-chalk-side)]'}`}
    >
      <h3 className="pd-display text-xl">{p.name}</h3>
      {p.summary ? <p className="mt-1 text-sm leading-relaxed">{p.summary}</p> : null}
      <p className={`pd-mono mt-3 text-base ${dark ? 'text-mint' : ''}`} style={{ fontWeight: 600 }}>
        {priceLine(p)}
      </p>
      {p.priceNote ? <p className="mt-1 text-xs">{p.priceNote}</p> : null}
      {p.features.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm">
          {p.features.map((f) => (
            <li key={f} className="flex gap-2">
              <span aria-hidden="true" className={`mt-[0.45em] size-1.5 shrink-0 rounded-sm ${dark ? 'bg-mint' : 'bg-graphite'}`} />
              {f}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto pt-4">
        <PlanButton planKey={p.key} tone={dark ? 'mint' : 'graphite'}>
          {p.ctaLabel ?? PRICING_SECTION.choose}
        </PlanButton>
      </div>
    </article>
  );
}
