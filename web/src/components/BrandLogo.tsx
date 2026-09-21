import { cn } from "@/lib/utils"

/**
 * Clean architectural brand emblem.
 * Replaces the playful cartoon mascot in navigation with a sleek,
 * precision-crafted financial privilege mark.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex size-8 sm:size-8.5 items-center justify-center rounded-lg bg-card/90 p-0.5 shadow-2xs ring-1 ring-border/80 transition-transform hover:scale-105 shrink-0 overflow-hidden",
        className,
      )}
      aria-hidden="true"
    >
      <img
        src="/logo-mark.webp"
        alt="DP Logo"
        className="size-full object-contain"
        width={34}
        height={34}
        loading="eager"
      />
    </div>
  )
}
