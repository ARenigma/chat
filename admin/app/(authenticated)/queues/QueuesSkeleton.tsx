import { Skeleton } from '@/components/ui/skeleton';

/** Loading state: the page header, tab strip and 8 list rows at their final sizes. */
export function QueuesSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading queues">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2 mb-4 h-4 w-64" />
        <div className="flex h-9 items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="border-t border-hairline">
        <div className="flex h-11 items-center border-b border-hairline px-(--page-pad)">
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="flex h-9 items-center gap-2 border-b border-hairline bg-hover px-4">
          <Skeleton className="h-3 w-24" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-9 items-center gap-3 border-b border-hairline px-4">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-[68px]" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
