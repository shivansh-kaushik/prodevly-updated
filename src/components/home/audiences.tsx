import { Section } from '@/components/home/station';
import { AUDIENCES } from '@/content/home';

const RULE: Record<(typeof AUDIENCES.items)[number]['field'], string> = {
  cobalt: 'border-cobalt',
  yolk: 'border-yolk',
  mint: 'border-mint-side',
  tomato: 'border-tomato',
};

/** Who we work with: one column per audience, so each visitor finds themself. No station. */
export function Audiences() {
  return (
    <Section id="audiences" field="chalk" className="py-20 pd-split:py-28">
      <div className="pd-halo max-w-[42rem]">
        <p className="pd-kicker">{AUDIENCES.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.7rem)] pd-split:text-[clamp(2.2rem,3.6vw,3.6rem)]">{AUDIENCES.title}</h2>
      </div>
      <ul className="mt-10 grid gap-8 pd-split:grid-cols-4 pd-split:gap-6">
        {AUDIENCES.items.map((a) => (
          <li key={a.name} className={`flex flex-col gap-2 border-t-4 pt-4 ${RULE[a.field]}`}>
            <h3 className="pd-display text-xl">{a.name}</h3>
            <p className="text-base leading-relaxed">
              <strong className="font-semibold">{AUDIENCES.comeWith}:</strong> {a.need}
            </p>
            <p className="text-base leading-relaxed">
              <strong className="font-semibold">{AUDIENCES.weDo}:</strong> {a.does}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
