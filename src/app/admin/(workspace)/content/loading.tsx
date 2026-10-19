import { Skeleton } from '@/components/ui/empty-state';

export default function ContentLoading() {
  return (
    <div aria-busy="true" aria-label="Loading website content" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
