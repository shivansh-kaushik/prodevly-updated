import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '@/lib/cx';
import { formatCount } from '@/lib/admin/format';
import { withParams, type PageMeta, type RawSearchParams } from '@/lib/admin/search-params';

/** "Showing 26-50 of 112" with previous and next links. Plain links, so it works without JS. */
export function Pagination({ meta, path, params, noun = 'records' }: { meta: PageMeta; path: string; params: RawSearchParams; noun?: string }) {
  if (meta.total === 0) return null;
  const link = (page: number) => withParams(path, params, { page: page === 1 ? undefined : page });
  const step = 'inline-grid size-9 place-items-center rounded-pd-sm text-pd-ink-2 hover:bg-pd-well pointer-coarse:size-11';
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3 text-[13px] text-pd-ink-3">
      <p className="pd-figure">
        Showing {formatCount(meta.from)}-{formatCount(meta.to)} of {formatCount(meta.total)} {noun}
      </p>
      {meta.pages > 1 ? (
        <div className="flex items-center gap-1">
          {meta.page > 1 ? (
            <Link href={link(meta.page - 1)} className={step} aria-label="Previous page" prefetch={false}><ChevronLeft className="size-4" aria-hidden /></Link>
          ) : (
            <span className={cx(step, 'opacity-40')} aria-hidden><ChevronLeft className="size-4" /></span>
          )}
          <span className="pd-figure px-1">Page {meta.page} of {meta.pages}</span>
          {meta.page < meta.pages ? (
            <Link href={link(meta.page + 1)} className={step} aria-label="Next page" prefetch={false}><ChevronRight className="size-4" aria-hidden /></Link>
          ) : (
            <span className={cx(step, 'opacity-40')} aria-hidden><ChevronRight className="size-4" /></span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
