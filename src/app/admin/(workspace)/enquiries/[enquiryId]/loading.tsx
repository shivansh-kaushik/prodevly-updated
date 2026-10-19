import { Skeleton } from '@/components/ui/empty-state';

// Shaped like the detail page (message beside the handling controls), not like the list the segment-level skeleton draws.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading enquiry" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-pd-rule-strong pb-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-64 max-w-full" />
      </div>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <Skeleton className="h-56" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
