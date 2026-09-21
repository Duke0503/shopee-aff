import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "bg-card ring-offset-background placeholder:text-muted-foreground/60 focus-visible:ring-[var(--ring)]/25 flex h-11 w-full rounded-lg border border-border/80 px-3.5 py-2 text-base sm:h-10 sm:text-sm focus-visible:ring-2 focus-visible:border-primary/50 focus-visible:outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50 shadow-2xs",
        className,
      )}
      {...props}
    />
  )
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm leading-none font-medium", className)}
      {...props}
    />
  )
}

export { Input, Label }
