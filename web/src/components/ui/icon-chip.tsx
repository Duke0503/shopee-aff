import type { LucideIcon } from "@/lib/icons"
import { cn } from "@/lib/utils"

/**
 * An icon with a job, in the colour of the thing it stands for.
 *
 * A 1.5px line icon dropped into running text reads as pasted in. The
 * same icon on a tinted square of its own colour reads as designed --
 * and because the tint is the state's colour, the chip does work: a
 * page of amber chips is a page of orders still waiting on Shopee.
 */
const TONES = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  danger: "bg-destructive-soft text-destructive",
  neutral: "bg-secondary text-muted-foreground",
} as const

const SIZES = {
  sm: "size-7 rounded-md [&_svg]:size-3.5",
  md: "size-9 rounded-lg [&_svg]:size-4.5",
  lg: "size-12 rounded-xl [&_svg]:size-6",
} as const

export type Tone = keyof typeof TONES

export function IconChip({
  icon: Glyph,
  tone = "primary",
  size = "md",
  className,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      <Glyph />
    </span>
  )
}
