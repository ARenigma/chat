import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { CircleNotch as Loader2 } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/*
 * Linear-style button. 13px, radius 6, 24-36px high.
 *   default / primary  coral fill (the one accent, used for the main action)
 *   secondary / outline hairline outline on the raised surface
 *   ghost              no chrome until hover
 *   destructive / danger  danger-tinted, fills only on hover
 *   link               accent text
 * Focus: the global :focus-visible outline (accent ring) is kept on purpose.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-sm text-sm font-medium whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger-dot [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active",
        primary: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active",
        secondary:
          "border border-hairline-strong bg-raised text-primary hover:bg-selected",
        outline:
          "border border-hairline-strong bg-raised text-primary hover:bg-selected",
        ghost: "text-body hover:bg-hover hover:text-primary data-[state=open]:bg-hover",
        destructive:
          "border border-danger-dot/40 bg-danger-subtle text-danger hover:bg-danger-dot hover:text-on-accent",
        danger:
          "border border-danger-dot/40 bg-danger-subtle text-danger hover:bg-danger-dot hover:text-on-accent",
        link: "h-auto rounded-xs px-0 text-accent-fg underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 px-2.5 has-[>svg]:px-2",
        lg: "h-9 px-4 text-base has-[>svg]:px-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

// -- Pappal async button (shows spinner while pending) -----------------------
interface AsyncButtonProps extends React.ComponentProps<typeof Button> {
  pending?: boolean;
}

export function AsyncButton({ pending, disabled, children, ...props }: AsyncButtonProps) {
  return (
    <Button disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}
