import { Skeleton } from '@/components/ui/skeleton';

/** Loading shapes for the Config pages (no enter animation; the pulse is opacity only). */
export function ConfigIndexSkeleton() {
  return (
    <div className="mx-auto max-w-[1040px]" aria-busy="true" aria-label="Loading config">
      <div className="mb-6">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-raised">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-2.5">
              <Skeleton className="size-6" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-3 w-48 max-w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-hairline bg-raised p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-6 flex flex-col gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfigDomainSkeleton() {
  return (
    <div className="mx-auto max-w-[760px]" aria-busy="true" aria-label="Loading config domain">
      <div className="mb-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-raised">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start justify-between gap-8 px-4 py-4">
            <div className="flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
