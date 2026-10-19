import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StageMount } from '@/components/site/stage-mount';

/**
 * /dev/stage: the stage engine on six fixture stations, for development and the
 * scripted checks (`npm run check:stage`). Not a design and not public: it 404s
 * in production unless NEXT_PUBLIC_STAGE_DEV=1 (preview builds, poster renders).
 *
 * Query: ?tier=0..3 forces a tier, ?debug=stage shows the overlay,
 * ?omit=work,pricing drops stations (as an empty admin section would).
 */
export const metadata: Metadata = {
  title: 'Stage engine',
  robots: { index: false, follow: false },
};

interface Station {
  key: string;
  label: string;
  field: string;
  ink: string;
}

const STATIONS: Station[] = [
  { key: 'hero', label: 'Hero', field: '#ece6d9', ink: '#1b1f27' },
  { key: 'services', label: 'Services', field: '#dfe7f2', ink: '#16202e' },
  { key: 'work', label: 'Work', field: '#1d2533', ink: '#f3f1ec' },
  { key: 'pricing', label: 'Pricing', field: '#f1e3cf', ink: '#2a1d0e' },
  { key: 'team', label: 'Team', field: '#dcebe3', ink: '#14261d' },
  { key: 'contact', label: 'Contact', field: '#e9e1ee', ink: '#22192a' },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DevStagePage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_STAGE_DEV !== '1') notFound();
  const sp = await searchParams;
  const omit = new Set(String(sp.omit ?? '').split(',').filter(Boolean));
  const stations = STATIONS.filter((s) => !omit.has(s.key));

  return (
    <>
      <main id="main">
        {stations.map((s, i) => (
          <StationSection key={s.key} station={s} first={i === 0} />
        ))}
        {/* A band with no station, like Partners: the subject travels while it passes. */}
        <section className="relative" style={{ color: '#1b1f27' }}>
          <div className="absolute inset-0 z-0" style={{ background: '#f7f4ee' }} />
          <div className="relative z-20 mx-auto max-w-5xl px-4 py-24 text-sm">Band without a station</div>
        </section>
      </main>
      <footer className="relative" style={{ color: '#f3f1ec' }}>
        <div className="absolute inset-0 z-0" style={{ background: '#11141a' }} />
        <div className="relative z-20 mx-auto grid min-h-svh max-w-5xl place-items-center px-4">
          Footer: no station in view, the stage stops drawing.
        </div>
      </footer>
      <StageMount direction="fixture" />
    </>
  );
}

function StationSection({ station, first }: { station: Station; first: boolean }) {
  const Heading = first ? 'h1' : 'h2';
  return (
    <section id={station.key} data-chapter={station.key} className="relative" style={{ color: station.ink }}>
      <div className="absolute inset-0 z-0" style={{ background: station.field }} />
      {/* Phone: heading top, stage zone in the middle, card below. Desktop: card left, stage right. */}
      {/* pd-split: follows the stage's aspect buckets, so a portrait tablet stays stacked. */}
      <div className="relative z-20 mx-auto grid min-h-svh max-w-6xl content-between gap-6 px-4 py-10 pd-split:grid-cols-2 pd-split:content-center pd-split:py-0">
        <Heading className="text-4xl font-semibold tracking-tight pd-split:col-start-1 pd-split:row-start-1">{station.label}</Heading>
        <div
          className="pd-poster grid h-[46svh] place-items-center rounded-lg border border-current/15 text-xs opacity-60 pd-split:col-start-2 pd-split:row-span-2 pd-split:h-[70svh]"
          aria-hidden="true"
        >
          poster
        </div>
        <div
          className="rounded-lg p-5 text-sm leading-relaxed pd-split:col-start-1 pd-split:row-start-2"
          style={{ background: station.field }}
        >
          Engine fixture station <code>{station.key}</code>. The page scroll only sets a target; the 3D follows it.
        </div>
      </div>
    </section>
  );
}
