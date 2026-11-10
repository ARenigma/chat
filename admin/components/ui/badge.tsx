import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'

/** Dot colour class per tone (all token-backed). */
const DOT: Record<Tone, string> = {
  success: 'bg-success-dot',
  warning: 'bg-warning-dot',
  danger: 'bg-danger-dot',
  info: 'bg-info-dot',
  neutral: 'bg-neutral-dot',
  accent: 'bg-accent',
}

/** Tinted pill classes per tone: subtle bg + fg text. */
const TINT: Record<Tone, string> = {
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  neutral: 'bg-neutral-subtle text-neutral',
  accent: 'bg-accent-subtle text-accent-fg',
}

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2 h-5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // Linear label chip: hairline outline, body text, optional dot.
        default: "border-hairline-strong text-body",
        outline: "border-hairline-strong text-body [a&]:hover:bg-hover",
        secondary: "bg-selected text-body",
        destructive: "bg-danger-subtle text-danger",
        ghost: "text-secondary [a&]:hover:bg-hover",
        link: "text-accent-fg underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** A small status dot. Use alone or inside chips. */
export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[tone], className)} />
}

function Badge({
  className,
  variant = "default",
  asChild = false,
  dot,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; dot?: Tone }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && !asChild && <Dot tone={dot} />}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }

// -- Pappal semantic badge ----------------------------------------------------
const STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  promoted_prod: 'success',
  approved: 'success',
  activation_cron: 'success',
  live: 'success',
  draft: 'warning',
  under_review: 'warning',
  needs_info: 'warning',
  partial: 'warning',
  superseded: 'neutral',
  draft_created: 'neutral',
  seeded: 'neutral',
  scheduled: 'info',
  submitted: 'info',
  error: 'danger',
  rollback: 'danger',
  rejected: 'danger',
}

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral'
}

/**
 * Status pill: dot + sentence-case label on a subtle tinted background.
 * `status` is the raw DB value (promoted_prod, under_review ...); pass `tone`
 * to override the mapping and `children` to override the label.
 */
export function StatusBadge({
  status,
  tone,
  children,
  className,
}: {
  status: string
  tone?: Tone
  children?: React.ReactNode
  className?: string
}) {
  const t = tone ?? statusTone(status)
  return (
    <span
      data-slot="status-badge"
      data-tone={t}
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        TINT[t],
        className
      )}
    >
      <Dot tone={t} />
      <span className="first-letter:uppercase">{children ?? status.replace(/_/g, ' ')}</span>
    </span>
  )
}

export function RuntimeBadge({ status }: { status?: string }) {
  if (!status) return null
  return (
    <StatusBadge status={status} className="h-4 px-1.5 text-2xs uppercase tracking-wide">
      {status}
    </StatusBadge>
  )
}
