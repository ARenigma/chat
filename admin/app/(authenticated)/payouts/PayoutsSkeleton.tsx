import { Skeleton } from '@/components/ui/skeleton';

/** Loading state: header, three stat cards, tab strip and table rows at their final sizes. */
export function PayoutsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading payouts">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2 mb-5 h-4 w-72" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-hairline bg-raised p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-6 w-32" />
              <Skeleton className="mt-3 h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex h-9 items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="border-t border-hairline">
        <div className="flex h-11 items-center border-b border-hairline px-(--page-pad)">
          <Skeleton className="h-7 w-56" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-9 items-center gap-4 border-b border-hairline px-4">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="ml-auto h-3 w-16" />
            <Skeleton className="h-4 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
