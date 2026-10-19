import Image from 'next/image';
import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { ArrowGlyph, KeyLink } from '@/components/home/key';
import { Nav, type NavKey } from '@/components/home/nav';
import { CASE_STUDY, FOOTER } from '@/content/home';
import type { PublicShowcaseItem, PublicSiteInfo } from '@/lib/content/types';

/**
 * `/work/[slug]`: one project as an article. Everything on it comes from the published
 * record; a part the team left empty is not shown, and a number appears only if the team
 * typed it. No 3D: it loads fast, reads like an article and is easy to share.
 */
const NAV: NavKey[] = ['work', 'services', 'contact'];

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function formatDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function CaseStudy({ item, next, site }: { item: PublicShowcaseItem; next: { slug: string; title: string } | null; site: PublicSiteInfo | null }) {
  const all: Array<{ title: string; text: string | null }> = [
    { title: CASE_STUDY.brief, text: item.body.brief },
    { title: CASE_STUDY.built, text: item.body.built },
    { title: CASE_STUDY.result, text: item.body.result },
  ];
  const parts = all.filter((p): p is { title: string; text: string } => Boolean(p.text?.trim()));

  return (
    <>
      <a href="#main" className="absolute left-2 top-2 z-50 -translate-y-20 rounded bg-chalk px-3 py-2 text-sm text-graphite focus:translate-y-0">
        {FOOTER.skip}
      </a>
      <Nav keys={NAV} base="/" />
      <main id="main" className="bg-chalk pt-14 text-graphite">
        <header className="bg-yolk">
          <div className="mx-auto flex max-w-[72rem] flex-col gap-5 px-4 pb-12 pt-10 pd-split:px-10 pd-split:pb-14 pd-split:pt-16">
            <Link href="/#work" className="pd-mono self-start text-xs uppercase underline-offset-4 hover:underline">
              ← {CASE_STUDY.back}
            </Link>
            <h1 className="pd-display text-[clamp(2.4rem,10vw,4.6rem)]">{item.title}</h1>
            <p className="max-w-[48rem] text-lg leading-relaxed pd-split:text-xl">{item.summary}</p>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              {item.clientDisplayName ? (
                <p className="flex flex-col gap-1">
                  <span className="pd-mono text-[0.6875rem] uppercase">{CASE_STUDY.client}</span>
                  <span className="font-semibold">{item.clientDisplayName}</span>
                </p>
              ) : null}
              {item.completedOn ? (
                <p className="flex flex-col gap-1">
                  <span className="pd-mono text-[0.6875rem] uppercase">{CASE_STUDY.completed}</span>
                  <span className="font-semibold">{formatDate(item.completedOn)}</span>
                </p>
              ) : null}
              {item.services.length > 0 || item.stack.length > 0 ? (
                <p className="flex flex-wrap gap-1.5">
                  {item.services.map((s) => (
                    <span key={s.slug} className="pd-mono rounded bg-graphite px-2 py-1 text-[0.6875rem] uppercase text-yolk">
                      {s.title}
                    </span>
                  ))}
                  {item.stack.map((s) => (
                    <span key={s} className="pd-mono rounded border border-graphite/40 px-2 py-1 text-[0.6875rem] uppercase">
                      {s}
                    </span>
                  ))}
                </p>
              ) : null}
              {item.liveUrl ? (
                <KeyLink href={item.liveUrl} tone="graphite" target="_blank" rel="noopener noreferrer" className="pd-split:ml-auto">
                  {CASE_STUDY.visit} <span aria-hidden="true">↗</span>
                </KeyLink>
              ) : null}
            </div>
          </div>
        </header>

        {item.cover ? (
          <div className="mx-auto max-w-[72rem] px-0 pd-split:px-10">
            <Image
              src={item.cover.url}
              alt={item.cover.alt}
              width={item.cover.width ?? 1600}
              height={item.cover.height ?? 900}
              sizes="(min-width: 768px) 72rem, 100vw"
              priority
              unoptimized
              className="aspect-[16/9] w-full object-cover pd-split:rounded-b-2xl"
            />
          </div>
        ) : null}

        <article className="mx-auto flex max-w-[72rem] flex-col gap-14 px-4 py-16 pd-split:px-10 pd-split:py-24">
          {parts.map((p, i) => (
            <section key={p.title} className="grid gap-4 border-t-2 border-graphite pt-6 pd-split:grid-cols-[1fr_2fr] pd-split:gap-10">
              <div>
                <p className="pd-mono text-xs">0{i + 1}</p>
                <h2 className="pd-display mt-2 text-[clamp(1.6rem,6vw,2.2rem)]">{p.title}</h2>
              </div>
              <div className="grid gap-4 text-lg leading-[1.7]">
                {paragraphs(p.text).map((para, k) => (
                  <p key={k} className="whitespace-pre-line">
                    {para}
                  </p>
                ))}
              </div>
            </section>
          ))}

          {item.gallery.length > 0 ? (
            <section aria-label={CASE_STUDY.gallery} className="grid gap-4 pd-split:grid-cols-2">
              {item.gallery.map((img) => (
                <Image
                  key={img.url}
                  src={img.url}
                  alt={img.alt}
                  width={img.width ?? 1200}
                  height={img.height ?? 900}
                  sizes="(min-width: 768px) 36rem, 100vw"
                  unoptimized
                  className="h-auto w-full rounded-2xl bg-white object-cover shadow-[inset_0_-0.35rem_0_var(--color-chalk-side)]"
                />
              ))}
            </section>
          ) : null}
        </article>

        <section className="pd-on-dark bg-graphite text-chalk">
          <div className="mx-auto grid max-w-[72rem] items-center gap-8 px-4 py-14 pd-split:grid-cols-2 pd-split:px-10 pd-split:py-20">
            {next ? (
              <Link href={`/work/${next.slug}`} className="group flex flex-col gap-2 rounded-2xl bg-[#2a2d34] p-6">
                <span className="pd-mono text-xs uppercase text-mint">{CASE_STUDY.next}</span>
                <span className="pd-display flex items-center gap-3 text-[clamp(1.4rem,5vw,2rem)]">
                  {next.title}
                  <ArrowGlyph className="transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ) : (
              <span />
            )}
            <div className="flex flex-col items-start gap-4">
              <h2 className="pd-display text-[clamp(1.8rem,6vw,2.6rem)]">{CASE_STUDY.ctaTitle}</h2>
              <KeyLink href="/#contact" enter className="text-base" style={{ padding: '1em 1.8em' }}>
                {CASE_STUDY.cta}
              </KeyLink>
            </div>
          </div>
        </section>
      </main>
      <Footer keys={NAV} site={site} base="/" />
    </>
  );
}
