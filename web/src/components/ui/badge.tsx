import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * A state, in the colour that state owns everywhere else on the site.
 * Four grey badges make a customer read four words to find their money.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        warning: "border-transparent bg-warning-soft text-warning",
        success: "border-transparent bg-success-soft text-success",
        info: "border-transparent bg-info-soft text-info",
        danger: "border-transparent bg-destructive-soft text-destructive",
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
