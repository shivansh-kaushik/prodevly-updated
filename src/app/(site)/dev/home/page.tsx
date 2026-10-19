import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Home } from '@/components/home/home';
import { sampleHome } from './sample';

/**
 * /dev/home: the real home page with SAMPLE records, for development and the scripted
 * checks. Query: ?projects=0..8 &plans=0..5 &people=0..9 &partners=0..4 set how many
 * records each section gets (0 hides the section, with its nav key and station);
 * ?tier=0..3 and ?debug=stage are the stage's dev tools. 404s in production unless
 * NEXT_PUBLIC_STAGE_DEV=1.
 */
export const metadata: Metadata = { title: 'Home (sample records)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const count = (value: string | string[] | undefined, fallback: number, max: number) => {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && value !== undefined ? Math.max(0, Math.min(max, Math.floor(n))) : fallback;
};

export default async function DevHomePage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_STAGE_DEV !== '1') notFound();
  const sp = await searchParams;
  return <Home content={sampleHome({ projects: count(sp.projects, 4, 8), plans: count(sp.plans, 3, 5), people: count(sp.people, 5, 9), partners: count(sp.partners, 0, 4) })} />;
}
