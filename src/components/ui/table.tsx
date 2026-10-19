import Link from 'next/link';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '@/lib/cx';
import { withParams, type RawSearchParams } from '@/lib/admin/search-params';

/**
 * Tables as an account book: a ruled header, hairline rows, figures right-aligned in tabular
 * numerals, and totals closed with the accountant's rule (`<TotalRow>`). Tables scroll
 * horizontally inside their own frame on a phone; they never push the page sideways.
 * Server-component friendly: sorting is a link, so it works without any client JS.
 */
export function TableFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-pd-md bg-pd-leaf shadow-[0_0_0_1px_var(--color-pd-rule)]', className)}>
      {children}
    </div>
  );
}

export function Table({ children, className, caption }: { children: React.ReactNode; className?: string; caption?: string }) {
  return (
    <table className={cx('w-full min-w-[40rem] border-collapse text-left text-[14px]', className)}>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {children}
    </table>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-pd-rule-strong bg-pd-paper">{children}</thead>;
}

interface ThProps {
  children?: React.ReactNode;
  numeric?: boolean;
  className?: string;
  /** Sort support: the column key, the current params and the base path. */
  sort?: { key: string; path: string; params: RawSearchParams; active: string; dir: 'asc' | 'desc' };
  width?: string;
}

export function Th({ children, numeric, className, sort, width }: ThProps) {
  const base = cx('pd-eyebrow h-9 px-3 align-middle whitespace-nowrap first:pl-4 last:pr-4', numeric ? 'text-right' : 'text-left', className);
  if (!sort) return <th scope="col" className={base} style={width ? { width } : undefined}>{children}</th>;
  const active = sort.active === sort.key;
  const nextDir = active && sort.dir === 'desc' ? 'asc' : 'desc';
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={base} style={width ? { width } : undefined}>
      <Link
        href={withParams(sort.path, sort.params, { sort: sort.key, dir: nextDir })}
        className={cx('inline-flex items-center gap-1 hover:text-pd-ink', numeric && 'flex-row-reverse', active && 'text-pd-ink')}
        prefetch={false}
      >
        {children}
        {active ? <Icon className="size-3" aria-hidden /> : null}
      </Link>
    </th>
  );
}

export function Tr({ children, className, flag, href }: { children: React.ReactNode; className?: string; flag?: boolean; href?: never }) {
  void href;
  return (
    <tr className={cx('border-b border-pd-rule-soft transition-colors duration-100 last:border-b-0 hover:bg-pd-well/60', flag && 'pd-margin-flag', className)}>
      {children}
    </tr>
  );
}

export function Td({ children, numeric, className, muted, colSpan }: { children?: React.ReactNode; numeric?: boolean; className?: string; muted?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('h-10 px-3 align-middle first:pl-4 last:pr-4', numeric && 'pd-figure text-right whitespace-nowrap', muted && 'text-pd-ink-3', className)}>
      {children}
    </td>
  );
}

/** A row that links through to its record: the first cell carries the link, the whole row hovers. */
export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx('font-medium text-pd-ink underline-offset-2 hover:underline', className)} prefetch={false}>
      {children}
    </Link>
  );
}

/** The closing row of a column of figures: single rule above, double below. */
export function TotalRow({ children }: { children: React.ReactNode }) {
  return <tr className="pd-total bg-pd-paper font-semibold">{children}</tr>;
}
