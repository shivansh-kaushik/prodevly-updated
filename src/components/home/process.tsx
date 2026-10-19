import { Section } from '@/components/home/station';
import { PROCESS } from '@/content/home';

/** How we work: four steps on graphite cards, each saying what the client receives. No station. */
export function Process() {
  return (
    <Section id="process" field="graphite" className="py-20 pd-split:py-28">
      <div className="pd-halo max-w-[42rem]">
        <p className="pd-kicker">{PROCESS.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.7rem)] pd-split:text-[clamp(2.2rem,3.6vw,3.6rem)]">{PROCESS.title}</h2>
      </div>
      <ol className="mt-10 grid gap-3 pd-split:grid-cols-4">
        {PROCESS.steps.map((step, i) => (
          <li key={step.name} className="flex flex-col gap-3 rounded-xl bg-[#2a2d34] p-5 shadow-[inset_0_-0.35rem_0_var(--color-graphite-side)]">
            <p className="pd-mono text-sm uppercase text-mint">
              0{i + 1} · {step.name}
            </p>
            <p className="text-base leading-relaxed">{step.text}</p>
            <p className="text-sm leading-relaxed text-chalk-side">
              {PROCESS.receive}: {step.receive}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
