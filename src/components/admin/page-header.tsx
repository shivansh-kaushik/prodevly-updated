import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * The top of a page: where you are (a quiet breadcrumb), what this is (a serif title the eye
 * lands on first), a line of context, and the actions that belong to the page.
 */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  crumbs?: ReadonlyArray<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  /** Badges or a reference number shown beside the title. */
  meta?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-3">
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-pd-ink-3">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.href ? <Link href={c.href} prefetch={false} className="hover:text-pd-ink hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
                {i < crumbs.length - 1 ? <ChevronRight className="size-3.5" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-pd-rule-strong pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-pd-serif text-[28px] leading-9 font-semibold tracking-[-0.02em] text-pd-ink">{title}</h1>
            {meta}
          </div>
          {description ? <p className="mt-1 max-w-2xl text-[14px] leading-5 text-pd-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
