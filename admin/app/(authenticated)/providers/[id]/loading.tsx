import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading provider">
      <div className="mx-auto grid max-w-[1040px] gap-10 px-(--page-pad) py-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-3 h-4 w-80" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-10 h-5 w-24" />
          <div className="mt-4 flex flex-col gap-3.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-[18px] rounded-full" />
                <Skeleton className="h-4 w-72" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
