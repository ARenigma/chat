import { cn } from "@/lib/utils"

/** Properties sidebar block: small secondary heading, then compact rows. */
export function PropertyGroup({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-0.5', className)}>
      {title && <h3 className="mb-1 text-sm font-medium text-secondary tracking-normal">{title}</h3>}
      {children}
    </section>
  )
}

/** One compact property row: icon + value (and optional label hint on the right). */
export function Property({
  icon,
  children,
  hint,
  className,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('-mx-2 flex h-7 items-center gap-2 rounded-sm px-2 text-sm text-body transition-colors hover:bg-hover', className)}>
      {icon && <span className="flex size-4 items-center justify-center text-secondary">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-tertiary">{hint}</span>}
    </div>
  )
}

/** Initial-letter avatar (no image dependency). */
export function Avatar({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.5)) }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-selected font-medium text-body uppercase', className)}
    >
      {name.trim().charAt(0)}
    </span>
  )
}
