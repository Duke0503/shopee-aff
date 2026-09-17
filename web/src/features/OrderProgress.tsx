import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/labels"
import type { MyOrder } from "@/lib/api"

/**
 * Where one order has got to, as a journey rather than a status word.
 *
 * "awaiting_approval" is an engineer's noun. The person reading it wants
 * to know how far their money has travelled and whether it is still
 * moving, and three dots answer that in a glance where a badge needs a
 * sentence of explanation.
 *
 * A rejected order leaves the rail entirely: it is not further along
 * the same road, it came off it, and drawing it as a stalled journey
 * would suggest it might still finish.
 */
const STEPS = ["step_recorded", "step_approved", "step_paid"] as const

const REACHED: Record<MyOrder["status"], number> = {
  awaiting_approval: 1,
  approved: 2,
  paid: 3,
  rejected: 0,
}

export function OrderProgress({ status }: { status: MyOrder["status"] }) {
  const t = useT()

  if (status === "rejected") {
    return <Badge variant="danger">{t("step_rejected")}</Badge>
  }

  const reached = REACHED[status]

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 sm:overflow-visible">
      {STEPS.map((key, index) => {
        const step = index + 1
        const done = step <= reached
        const current = step === reached
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "size-2 rounded-full transition-colors",
                  done ? "bg-success" : "bg-border",
                  current && "ring-success/30 ring-4",
                )}
              />
              <span
                className={cn(
                  "text-[11px] whitespace-nowrap",
                  current
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {t(key)}
              </span>
            </div>
            {step < STEPS.length && (
              <span
                className={cn(
                  "h-px w-3",
                  step < reached ? "bg-success" : "bg-border",
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
