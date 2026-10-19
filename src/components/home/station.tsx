import type { CSSProperties, ReactNode } from 'react';
import { POSTERS } from '@/components/home/posters.generated';

/**
 * One home section: a solid colour field behind (z 0), the copy in front (z 20), and,
 * for a station, the stage zone where the totem stands (`data-chapter`). The section
 * itself creates no stacking context: no transform, filter, opacity, isolation,
 * contain or positioned z-index (docs/plan/engineering.html section 3), so the fixed
 * canvas sits between the fields and the copy.
 *
 * The station's centre is the centre of its content block, which is about one screen
 * tall, so the totem is at rest when that screen is in view. The zone is the space
 * reserved for the totem (`data-stage-zone`): the stage measures it and frames the
 * totem inside it, on every screen size. It carries `pd-poster`: the AVIF poster fills it until the
 * canvas has drawn, and again if the stage falls back (docs/plan/engineering.html
 * section 3).
 */
export type Field = 'cobalt' | 'chalk' | 'yolk' | 'mint' | 'tomato' | 'graphite';

const FIELD: Record<Field, string> = {
  cobalt: 'bg-cobalt',
  chalk: 'bg-chalk',
  yolk: 'bg-yolk',
  mint: 'bg-mint',
  tomato: 'bg-tomato',
  graphite: 'bg-graphite',
};

const DARK: Field[] = ['cobalt', 'tomato', 'graphite'];

export function Section({
  id,
  field,
  station,
  className = '',
  children,
}: {
  id: string;
  field: Field;
  /** Makes the content block a station (`data-chapter`). Omit when a section holds more than one screen. */
  station?: string;
  className?: string;
  children: ReactNode;
}) {
  const dark = DARK.includes(field);
  return (
    <section id={id} className={`relative scroll-mt-14 ${dark ? 'pd-on-dark text-chalk' : 'text-graphite'}`} style={{ '--field': `var(--color-${field})` } as CSSProperties}>
      <div className={`absolute inset-0 z-0 ${FIELD[field]}`} />
      <div data-chapter={station} className={`relative z-20 mx-auto w-full max-w-[88rem] px-4 pd-split:px-10 ${className}`}>
        {children}
      </div>
    </section>
  );
}

export function Zone({ station, className = '', eager = false }: { station: string; className?: string; eager?: boolean }) {
  return (
    <div data-stage-zone className={`pd-zone pd-poster ${className}`} aria-hidden="true">
      <Poster station={station} eager={eager} />
    </div>
  );
}

/**
 * The poster: an AVIF of the live scene in this station's composition, one per aspect
 * bucket (the same `pd-split` breakpoint as the layout). The hero's is the likely LCP
 * element, so it loads eagerly with high priority; the others load when near.
 */
function Poster({ station, eager }: { station: string; eager: boolean }) {
  const size = POSTERS[station];
  if (!size) return null;
  return (
    <picture>
      <source media="(min-width: 768px) and (min-aspect-ratio: 4/5)" srcSet={`/posters/keycap/${station}-wide.avif`} type="image/avif" width={size.wide.w} height={size.wide.h} />
      <img src={`/posters/keycap/${station}-tall.avif`} alt="" width={size.tall.w} height={size.tall.h} decoding="async" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} />
    </picture>
  );
}
