import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:opacity-92 ring-1 ring-primary/20 font-semibold",
        outline: "border border-border/90 bg-card hover:bg-muted/50 text-foreground shadow-2xs font-medium",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted font-medium",
        ghost: "hover:bg-muted/60 text-foreground/90 font-medium",
        success: "bg-success text-white hover:opacity-92 shadow-xs font-semibold",
      },
      size: {
        default: "h-11 px-4 py-2 sm:h-9.5 sm:px-4",
        sm: "h-9 rounded-md px-3 text-xs sm:h-8",
        lg: "h-12 rounded-lg px-6 text-base",
        icon: "h-11 w-11 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
