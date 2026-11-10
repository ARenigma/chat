"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

/*
 * Linear-style tabs: text row with a 2px accent underline that slides between
 * triggers (shared layout animation, 150ms). The underline sits on a hairline.
 */
const TabsCtx = React.createContext<{ value: string; id: string }>({ value: "", id: "" })

function Tabs({
  className,
  value: valueProp,
  defaultValue = "",
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [inner, setInner] = React.useState(defaultValue)
  const value = valueProp ?? inner
  const id = React.useId()
  return (
    <TabsCtx.Provider value={{ value, id }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        onValueChange={(v) => {
          setInner(v)
          onValueChange?.(v)
        }}
        className={cn("flex flex-col gap-4", className)}
        {...props}
      />
    </TabsCtx.Provider>
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex h-9 items-end gap-4 border-b border-hairline", className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = React.useContext(TabsCtx)
  const active = ctx.value === value
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 rounded-xs px-0.5 text-sm font-medium whitespace-nowrap text-secondary transition-colors duration-100 outline-offset-[-2px] hover:text-primary disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-primary",
        className
      )}
      {...props}
    >
      {children}
      {active && (
        <motion.span
          layoutId={`tab-underline-${ctx.id}`}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
        />
      )}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
