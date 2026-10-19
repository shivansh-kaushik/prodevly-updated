import { FOOTER, NAV_LABELS, SERVICES } from '@/content/home';
import { SITE } from '@/content/site';
import type { NavKey } from '@/components/home/nav';
import type { PublicSiteInfo } from '@/lib/content/types';

/**
 * A solid graphite field with no station: once no zone is in view the stage stops
 * drawing, so no GPU work runs behind it. It renders only the details that exist.
 */
export function Footer({ keys, site, base = '' }: { keys: readonly NavKey[]; site: PublicSiteInfo | null; base?: '' | '/' }) {
  return (
    <footer className="relative pd-on-dark text-chalk">
      <div className="absolute inset-0 z-0 bg-graphite" />
      <div className="relative z-20 mx-auto grid max-w-[88rem] gap-8 border-t border-chalk/15 px-4 py-12 pd-split:grid-cols-[2fr_1fr_1fr_1fr] pd-split:px-10">
        <div>
          <p className="pd-display text-xl" style={{ fontWeight: 880 }}>
            {SITE.name}
          </p>
          <p className="mt-3 max-w-[22rem] text-sm leading-relaxed">{FOOTER.line}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid gap-2 text-sm">
            {keys.map((k) => (
              <li key={k}>
                <a href={`${base}#${k}`} className="underline-offset-4 hover:underline">
                  {NAV_LABELS[k]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="grid gap-2 text-sm">
          {SERVICES.map((s) => (
            <li key={s.name}>{s.name}</li>
          ))}
        </ul>
        <ul className="grid content-start gap-2 text-sm">
          <li>
            <a href="/privacy" className="underline-offset-4 hover:underline">
              {FOOTER.privacy}
            </a>
          </li>
          {site?.email ? (
            <li>
              <a href={`mailto:${site.email}`} className="underline underline-offset-4">
                {site.email}
              </a>
            </li>
          ) : null}
          {site
            ? Object.entries(site.social).map(([name, url]) =>
                url ? (
                  <li key={name}>
                    <a href={url} className="underline-offset-4 hover:underline" rel="noopener noreferrer" target="_blank">
                      {name.charAt(0).toUpperCase() + name.slice(1)}
                    </a>
                  </li>
                ) : null,
              )
            : null}
        </ul>
        <p className="pd-mono text-xs pd-split:col-span-full">
          © {new Date().getFullYear()} {site?.legalName ?? SITE.name}
        </p>
      </div>
    </footer>
  );
}
