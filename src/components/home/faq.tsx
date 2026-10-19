import { Section } from '@/components/home/station';
import { FAQ } from '@/content/home';

/** Questions people ask. Only questions the team has answered show; none answered, no section. */
export function Faq() {
  const answered = FAQ.items.filter((item): item is { q: string; answer: string } => Boolean(item.answer));
  if (answered.length === 0) return null;
  return (
    <Section id="faq" field="chalk" className="py-20 pd-split:py-28">
      <div className="mx-auto max-w-[56rem]">
        <p className="pd-kicker">{FAQ.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.8rem,8vw,2.6rem)] pd-split:text-[clamp(2.1rem,3.4vw,3.3rem)]">{FAQ.title}</h2>
        <div className="mt-8 grid gap-2.5">
          {answered.map((item) => (
            <details key={item.q} className="group rounded-xl bg-white px-5 py-4 shadow-[inset_0_-0.25rem_0_var(--color-chalk-side)]">
              <summary className="pd-display flex min-h-7 cursor-pointer list-none items-center justify-between gap-4 text-lg">
                {item.q}
                <span aria-hidden="true" className="pd-mono text-xl transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-line text-base leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
