import * as React from "react"

import { cn } from "@/lib/utils"

/* Shared field chrome: raised bg, hairline-strong border, accent border + soft ring on focus. */
export const fieldClass =
  "w-full min-w-0 rounded-sm border border-hairline-strong bg-raised px-2.5 text-sm text-primary outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-tertiary hover:border-quaternary focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger-dot aria-invalid:ring-danger-dot/25 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-primary"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClass, "h-8", className)}
      {...props}
    />
  )
}

export { Input }

// Re-export Textarea for convenience (existing imports)
export { Textarea } from "@/components/ui/textarea"
