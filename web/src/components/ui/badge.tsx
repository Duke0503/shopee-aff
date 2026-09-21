import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * A state, in the colour that state owns everywhere else on the site.
 * Four grey badges make a customer read four words to find their money.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-2xs",
        secondary: "border-border/60 bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground bg-transparent",
        warning: "border-warning/20 bg-warning-soft text-warning font-medium",
        success: "border-success/20 bg-success-soft text-success font-medium",
        info: "border-info/20 bg-info-soft text-info font-medium",
        danger: "border-destructive/20 bg-destructive-soft text-destructive font-medium",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
