import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

// ── Pappal semantic badge ─────────────────────────────────────────────────
const STATUS_MAP: Record<string, string> = {
  active: 'badge-active',
  draft: 'badge-draft',
  superseded: 'badge-superseded',
  scheduled: 'badge-scheduled',
  error: 'badge-error',
  promoted_prod: 'badge-promoted_prod',
  draft_created: 'badge-draft_created',
  rollback: 'badge-rollback',
  activation_cron: 'badge-activation_cron',
  // Provider application statuses
  submitted: 'badge-submitted',
  under_review: 'badge-under_review',
  needs_info: 'badge-needs_info',
  approved: 'badge-approved',
  rejected: 'badge-rejected',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_MAP[status] ?? 'badge-superseded';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cls)}>
      {status}
    </span>
  );
}

const RUNTIME_MAP: Record<string, string> = {
  live: 'runtime-badge-live',
  partial: 'runtime-badge-partial',
  seeded: 'runtime-badge-seeded',
};

export function RuntimeBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cls = RUNTIME_MAP[status] ?? 'runtime-badge-seeded';
  return <span className={cn('runtime-badge', cls)}>{status}</span>;
}
