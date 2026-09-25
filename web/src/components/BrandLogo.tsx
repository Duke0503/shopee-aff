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
        "relative flex size-8.5 sm:size-9 items-center justify-center rounded-xl bg-card p-0.5 shadow-xs ring-1 ring-border/80 transition-transform hover:scale-105 shrink-0 overflow-hidden",
        className,
      )}
      aria-hidden="true"
    >
      <img
        src="/logo-mark.webp"
        alt="Hoàn Tiền DP"
        className="size-full object-contain"
        width={36}
        height={36}
        loading="eager"
      />
    </div>
  )
}
