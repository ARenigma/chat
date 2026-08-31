import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header skeleton */}
      <div className="mb-2">
        <Skeleton className="h-7 w-44 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="py-5 gap-2">
            <CardContent className="px-5">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* List panel */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          <div className="divide-y">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
