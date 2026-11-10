import { Skeleton } from '@/components/ui/skeleton';

/** Loading state shaped like the list: title, tab row, toolbar, two groups of rows. */
export function ProvidersListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading providers">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-2 mb-5 h-4 w-48" />
        <div className="flex h-9 items-center gap-4">
          {[56, 48, 72, 72].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="flex h-11 items-center gap-2 border-y border-hairline px-(--page-pad)">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="flex h-9 items-center gap-2 border-b border-hairline bg-hover px-4">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          {Array.from({ length: g === 0 ? rows - 2 : 2 }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 border-b border-hairline px-4">
              <Skeleton className="hidden h-3 w-16 md:block" />
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="size-[18px] rounded-full" />
              <Skeleton className="h-4 flex-1 max-w-48" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
