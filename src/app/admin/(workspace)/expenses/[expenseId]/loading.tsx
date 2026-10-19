import { Skeleton } from '@/components/ui/empty-state';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading expense" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-60" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
