import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-hairline bg-raised py-4 text-body",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold text-primary", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-secondary", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-4 [.border-t]:pt-4", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

// StatCard lives in stat-card.tsx (CountUp + delta + sparkline); re-exported
// here so existing `import { StatCard } from '@/components/ui/card'` keeps working.
export { StatCard } from "@/components/ui/stat-card"

// -- Pappal semantic composites ----------------------------------------------
interface PanelProps extends React.ComponentProps<"div"> {
  heading?: React.ReactNode;
  actions?: React.ReactNode;
  /** Replaces the content padding (e.g. "p-0" for full-bleed lists). */
  contentClassName?: string;
}

/** Bordered section: optional heading row with hairline underneath, then content. */
export function Panel({ heading, actions, children, className, contentClassName, ...props }: PanelProps) {
  return (
    <Card className={cn('gap-0 py-0', className)} {...props}>
      {(heading || actions) && (
        <div className="flex h-11 items-center justify-between gap-3 border-b border-hairline px-4">
          <CardTitle className="text-sm">{heading}</CardTitle>
          {actions}
        </div>
      )}
      <CardContent className={cn("px-4 py-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
