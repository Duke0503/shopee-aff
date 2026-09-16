import { cn } from "@/lib/utils"

/**
 * A short rise on arrival.
 *
 * Not decoration: a page whose parts all appear at the same instant
 * reads as a document being displayed, while a page whose parts arrive
 * in order reads as something being handed to you. The whole sequence
 * is under half a second, and it respects prefers-reduced-motion
 * through the CSS rather than by branching here.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <div
      className={cn("reveal", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
