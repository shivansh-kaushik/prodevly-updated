import { Skeleton } from '@/components/ui/empty-state';

/** The shape of the audit page: header, totals band, charts, toolbar and a page of entries. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the audit log" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-56" />
      <Skeleton className="h-9 max-w-md" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
      </div>
    </div>
  );
}
