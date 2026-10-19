import { Skeleton } from '@/components/ui/empty-state';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading tasks" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
