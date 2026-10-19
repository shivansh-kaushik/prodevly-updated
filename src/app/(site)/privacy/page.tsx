import type { Metadata } from 'next';
import { Footer } from '@/components/home/footer';
import { Nav, type NavKey } from '@/components/home/nav';
import { FOOTER } from '@/content/home';
import { PRIVACY } from '@/content/privacy';
import { loadSiteInfo } from '@/lib/content/home-loader';

export const metadata: Metadata = { title: PRIVACY.title };
export const revalidate = 3600;

const NAV: NavKey[] = ['work', 'services', 'contact'];

export default async function PrivacyPage() {
  const site = await loadSiteInfo();
  return (
    <>
      <a href="#main" className="absolute left-2 top-2 z-50 -translate-y-20 rounded bg-chalk px-3 py-2 text-sm text-graphite focus:translate-y-0">
        {FOOTER.skip}
      </a>
      <Nav keys={NAV} base="/" />
      <main id="main" className="bg-chalk pt-14 text-graphite">
        <article className="mx-auto max-w-[46rem] px-4 py-16 pd-split:py-24">
          <h1 className="pd-display text-[clamp(2.4rem,9vw,4rem)]">{PRIVACY.title}</h1>
          <p className="pd-mono mt-4 text-xs uppercase">{PRIVACY.updated}</p>
          {PRIVACY.sections.map((s) => (
            <section key={s.heading} className="mt-10">
              <h2 className="pd-display text-2xl">{s.heading}</h2>
              <p className="mt-3 text-lg leading-[1.7]">{s.body}</p>
            </section>
          ))}
          {site?.email ? (
            <p className="mt-10 text-lg">
              <a href={`mailto:${site.email}`} className="underline underline-offset-4">
                {site.email}
              </a>
            </p>
          ) : null}
        </article>
      </main>
      <Footer keys={NAV} site={site} base="/" />
    </>
  );
}
