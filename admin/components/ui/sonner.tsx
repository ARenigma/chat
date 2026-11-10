"use client"

import { CheckCircle, Info, CircleNotch, XCircle, Warning } from "@phosphor-icons/react/dist/ssr"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/* Toasts are floating layers: raised surface, hairline border, small shadow. Status colour only on the icon. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <CheckCircle size={16} className="text-success" />,
        info: <Info size={16} className="text-info" />,
        warning: <Warning size={16} className="text-warning" />,
        error: <XCircle size={16} className="text-danger" />,
        loading: <CircleNotch size={16} className="animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!font-sans !text-sm",
          description: "!text-secondary",
          actionButton: "!bg-accent !text-on-accent",
          cancelButton: "!bg-selected !text-body",
        },
      }}
      style={
        {
          "--normal-bg": "var(--raised)",
          "--normal-text": "var(--text-primary)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "8px",
          "--width": "340px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
