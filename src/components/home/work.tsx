import Image from 'next/image';
import { BoundList } from '@/components/home/bound-list';
import { KeyLink } from '@/components/home/key';
import { Section, Zone } from '@/components/home/station';
import { CASE_STUDY, WORK_SECTION } from '@/content/home';
import type { PublicShowcaseItem } from '@/lib/content/types';

/**
 * Work: one sleeve per published project (up to six), standing in a bin. The card
 * in focus (hover, focus, or the one in the middle of the rail) pulls its sleeve
 * forward. The 3D carries no titles or images; they stay here, in the DOM.
 */
export function Work({ projects }: { projects: PublicShowcaseItem[] }) {
  return (
    <Section id="work" field="yolk" station="work" className="grid min-h-svh grid-rows-[auto_minmax(20svh,1fr)_auto] gap-3 pb-6 pt-[4.5rem]">
      <div className="pd-halo pd-split:max-w-[40rem]">
        <p className="pd-kicker">{WORK_SECTION.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.7rem)] pd-split:text-[clamp(2.2rem,3.6vw,3.6rem)]">{WORK_SECTION.title}</h2>
        <p className="mt-3 text-base leading-relaxed pd-split:text-lg">{WORK_SECTION.lede}</p>
      </div>
      <Zone station="work" />
      <BoundList field="project" label="Projects" className="pd-rail pd-split:justify-center-safe">
        {projects.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
      </BoundList>
    </Section>
  );
}

function ProjectCard({ project: p }: { project: PublicShowcaseItem }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl bg-chalk text-graphite shadow-[inset_0_-0.4rem_0_var(--color-chalk-side)]">
      {p.cover ? (
        <Image src={p.cover.url} alt={p.cover.alt} width={p.cover.width ?? 800} height={p.cover.height ?? 500} sizes="(min-width: 768px) 22rem, 80vw" unoptimized className="aspect-[16/9] w-full object-cover" />
      ) : null}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="pd-display text-lg">{p.title}</h3>
        {p.clientDisplayName ? <p className="pd-mono mt-1 text-xs uppercase">{p.clientDisplayName}</p> : null}
        <p className="mt-2 line-clamp-4 text-sm leading-relaxed">{p.summary}</p>
        {p.services.length > 0 || p.stack.length > 0 ? (
          <p className="mt-3 flex flex-wrap gap-1.5">
            {p.services.map((s) => (
              <span key={s.slug} className="pd-mono rounded bg-graphite px-2 py-1 text-[0.6875rem] uppercase text-yolk">
                {s.title}
              </span>
            ))}
            {p.stack.map((s) => (
              <span key={s} className="pd-mono rounded border border-graphite/30 px-2 py-1 text-[0.6875rem] uppercase">
                {s}
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-auto pt-4">
          <KeyLink href={`/work/${p.slug}`} tone="graphite" enter className="text-xs">
            {CASE_STUDY.read}
            <span className="sr-only">: {p.title}</span>
          </KeyLink>
        </p>
      </div>
    </article>
  );
}
