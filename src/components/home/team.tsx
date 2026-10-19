import Image from 'next/image';
import { BoundList } from '@/components/home/bound-list';
import { Section, Zone } from '@/components/home/station';
import { TEAM_SECTION } from '@/content/home';
import type { PublicDeveloper } from '@/lib/content/types';
import { initialOf } from '@/lib/stage-data';

/**
 * Developers: one key per person (up to seven stand on the shelf), each printed with
 * their initial. The cards are solid chalk, because small text never sits on the
 * tomato field. A person's card lifts their key on hover or focus.
 */
export function Team({ people }: { people: PublicDeveloper[] }) {
  return (
    <Section id="team" field="tomato" station="team" className="grid min-h-svh grid-rows-[auto_minmax(20svh,1fr)_auto] gap-3 pb-6 pt-[4.5rem]">
      <div className="pd-halo pd-split:max-w-[40rem]">
        <p className="pd-kicker inline-flex rounded bg-graphite px-2 py-1.5 [text-shadow:none] before:bg-tomato">{TEAM_SECTION.eyebrow}</p>
        <h2 className="pd-display mt-3 text-[clamp(1.9rem,8.4vw,2.9rem)] pd-split:text-[clamp(2.2rem,3.9vw,3.8rem)]">{TEAM_SECTION.title}</h2>
      </div>
      <Zone station="team" />
      <BoundList field="person" label="Developers" className="pd-rail pd-split:justify-center-safe" itemClassName="pd-split:!flex-[1_1_12rem] pd-split:!max-w-[16rem]">
        {people.map((p) => (
          <PersonCard key={p.key} person={p} />
        ))}
      </BoundList>
    </Section>
  );
}

function PersonCard({ person: p }: { person: PublicDeveloper }) {
  return (
    <article className="flex h-full flex-col rounded-xl bg-chalk p-4 text-graphite shadow-[inset_0_-0.4rem_0_var(--color-chalk-side)]">
      <div className="flex items-center gap-3">
        {p.photo ? (
          <Image src={p.photo.url} alt={p.photo.alt} width={p.photo.width ?? 96} height={p.photo.height ?? 96} unoptimized className="size-12 rounded-lg object-cover" />
        ) : (
          <span aria-hidden="true" className="pd-display grid size-12 shrink-0 place-items-center rounded-lg bg-graphite text-xl text-chalk">
            {initialOf(p.displayName)}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="pd-display truncate text-base">{p.displayName}</h3>
          {p.title ? <p className="pd-mono truncate text-xs uppercase">{p.title}</p> : null}
        </div>
      </div>
      {p.bio ? <p className="mt-3 line-clamp-2 text-sm leading-relaxed">{p.bio}</p> : null}
      {p.skills.length > 0 ? (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {p.skills.slice(0, 4).map((s) => (
            <span key={s} className="pd-mono rounded bg-graphite px-2 py-1 text-[0.6875rem] uppercase text-yolk">
              {s}
            </span>
          ))}
        </p>
      ) : null}
      {p.links.github || p.links.linkedin || p.links.website ? (
        <p className="pd-mono mt-auto flex gap-3 pt-3 text-xs">
          {p.links.github ? <a href={p.links.github} className="underline underline-offset-4" rel="noopener noreferrer" target="_blank">GitHub<span className="sr-only">: {p.displayName}</span></a> : null}
          {p.links.linkedin ? <a href={p.links.linkedin} className="underline underline-offset-4" rel="noopener noreferrer" target="_blank">LinkedIn<span className="sr-only">: {p.displayName}</span></a> : null}
          {p.links.website ? <a href={p.links.website} className="underline underline-offset-4" rel="noopener noreferrer" target="_blank">Website<span className="sr-only">: {p.displayName}</span></a> : null}
        </p>
      ) : null}
    </article>
  );
}
