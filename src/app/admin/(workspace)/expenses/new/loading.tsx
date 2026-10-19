import { Skeleton } from '@/components/ui/empty-state';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the expense form" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-28" />
    </div>
  );
}
