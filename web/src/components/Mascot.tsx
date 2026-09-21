import * as React from "react"
import { cn } from "@/lib/utils"

export type Mood = "happy" | "waiting" | "celebrating" | "shy" | "peeking"
export type MascotVariant = "2d" | "3d-pot" | "fintech-bot"

const MOOD_IMAGES_2D: Record<Mood, string> = {
  happy: "/mascot-happy.webp",
  shy: "/mascot-shy.webp",
  peeking: "/mascot-peeking.webp",
  waiting: "/mascot-waiting.webp",
  celebrating: "/mascot-celebrating.webp",
}

export function Mascot({
  className,
  mood = "happy",
  variant,
}: {
  className?: string
  mood?: Mood
  variant?: MascotVariant
}) {
  const [pref, setPref] = React.useState<MascotVariant>("2d")

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mascot_variant") as MascotVariant
      if (saved && (saved === "2d" || saved === "3d-pot" || saved === "fintech-bot")) {
        setPref(saved)
      }
      // Preload all mood variations so swapping poses when typing password is instant
      Object.values(MOOD_IMAGES_2D).forEach((url) => {
        const img = new Image()
        img.src = url
      })
    }
  }, [])

  const activeVariant = variant || pref

  const src =
    activeVariant === "3d-pot"
      ? "/mascot-3d-pot.webp"
      : activeVariant === "fintech-bot"
      ? "/mascot-fintech-bot.webp"
      : MOOD_IMAGES_2D[mood] || MOOD_IMAGES_2D.happy

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 transition-transform duration-200 select-none",
        mood === "celebrating" && "scale-105 -translate-y-1",
        mood === "waiting" && "opacity-90",
        mood === "shy" && "scale-95",
        mood === "peeking" && "rotate-[1deg]",
        className,
      )}
      data-mood={mood}
      aria-hidden="true"
    >
      <img
        key={src}
        src={src}
        alt="DP Mascot"
        className="size-full object-contain drop-shadow-sm transition-all duration-200"
        loading="eager"
        width={96}
        height={96}
      />
    </div>
  )
}
