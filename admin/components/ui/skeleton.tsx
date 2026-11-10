import { cn } from "@/lib/utils"

/* Opacity pulse (no transform, no layout); reduced motion collapses it via the global rule. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-[skeleton_1.6s_ease-in-out_infinite] rounded-sm bg-selected", className)}
      {...props}
    />
  )
}

export { Skeleton }
