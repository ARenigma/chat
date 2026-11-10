import { cn } from "@/lib/utils"
import type { Tone } from "@/components/ui/badge"

export type StatusIconState = 'backlog' | 'todo' | 'progress' | 'done' | 'canceled'

const STROKE: Record<Tone, string> = {
  success: 'text-success-dot',
  warning: 'text-warning-dot',
  danger: 'text-danger-dot',
  info: 'text-info-dot',
  neutral: 'text-neutral-dot',
  accent: 'text-accent',
}

/**
 * Linear-style status ring: dashed (backlog), empty ring (todo), half-filled
 * (in progress), filled with a tick (done), crossed (canceled). Colour comes
 * from a status tone, never hard-coded.
 */
export function StatusIcon({
  state,
  tone = 'neutral',
  size = 14,
  className,
}: {
  state: StatusIconState
  tone?: Tone
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', STROKE[tone], className)}
    >
      <circle
        cx="7"
        cy="7"
        r="5.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={state === 'backlog' ? '1.6 2.1' : undefined}
        fill={state === 'done' ? 'currentColor' : 'none'}
      />
      {state === 'progress' && <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
      {state === 'done' && <path d="M4.4 7.2l1.8 1.8 3.4-3.6" stroke="var(--raised)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      {state === 'canceled' && <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  )
}
