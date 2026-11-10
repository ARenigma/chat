import * as React from "react"

import { cn } from "@/lib/utils"

/** Shortcut hint chip, e.g. <Kbd>⌘K</Kbd>. Decorative: hide from AT if the control has its own label. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-hairline-strong bg-hover px-1 font-sans text-2xs leading-none font-medium text-secondary",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-0.5", className)} {...props} />
}

export { Kbd, KbdGroup }
