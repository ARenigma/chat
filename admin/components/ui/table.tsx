"use client"

import * as React from "react"
import { CaretDown, CaretRight } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { cn } from "@/lib/utils"

/*
 * Dense data table: 36px rows, 12px tertiary header, hairline separators, row
 * hover, selected row via data-state="selected". No enter animation on rows
 * (admin is used all day). For a sticky header give the wrapper a bounded
 * height: <Table containerClassName="max-h-[60vh] overflow-y-auto">.
 */
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-separate border-spacing-0 text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child>td]:border-b-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("font-medium [&>tr>td]:border-t [&>tr>td]:border-hairline", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row transition-colors duration-100 hover:bg-hover has-aria-expanded:bg-hover data-[state=selected]:bg-selected",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "sticky top-0 z-[1] h-8 border-b border-hairline bg-surface px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-tertiary first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-9 border-b border-hairline px-3 align-middle whitespace-nowrap text-body first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-xs text-tertiary", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

/* ── List: Linear-style grouped rows ─────────────────────────────────────── */

/** Container for ListGroup / ListRow. */
export function List({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="list" role="list" className={cn("flex flex-col", className)} {...props} />
}

/**
 * Group header (icon + title + count + actions) with collapsible rows. Header
 * is 36px on a faint hover tint, like Linear's status groups.
 */
export function ListGroup({
  icon,
  title,
  count,
  actions,
  defaultOpen = true,
  children,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  count?: number
  actions?: React.ReactNode
  defaultOpen?: boolean
  children?: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()
  return (
    <section data-slot="list-group" className={className}>
      <div className="flex h-9 items-center gap-2 border-b border-hairline bg-hover px-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left"
        >
          <span className="text-tertiary">{open ? <CaretDown size={12} /> : <CaretRight size={12} />}</span>
          {icon}
          <span className="truncate text-sm font-medium text-primary">{title}</span>
          {count !== undefined && <span className="text-sm text-tertiary">{count}</span>}
        </button>
        {actions}
      </div>
      {open && <div id={id} role="presentation">{children}</div>}
    </section>
  )
}

/** One 36px row. Pass `href` to render a link; `selected` for the selected tint. */
export function ListRow({
  href,
  selected,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onClick"> & {
  href?: string
  selected?: boolean
  onClick?: React.MouseEventHandler<HTMLElement>
}) {
  const cls = cn(
    "flex h-9 w-full items-center gap-3 border-b border-hairline px-4 text-left text-sm text-body transition-colors duration-100 hover:bg-hover",
    selected && "bg-selected",
    className
  )
  if (href) {
    return (
      <Link
        href={href}
        role="listitem"
        data-selected={selected || undefined}
        className={cls}
        {...(props as Omit<React.ComponentProps<typeof Link>, "href">)}
      >
        {children}
      </Link>
    )
  }
  return (
    <div role="listitem" data-slot="list-row" data-selected={selected || undefined} className={cls} {...props}>
      {children}
    </div>
  )
}

/** Muted mono id cell (e.g. PAP-142). */
export function ListId({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("w-16 shrink-0 font-mono text-xs text-tertiary", className)} {...props} />
}
