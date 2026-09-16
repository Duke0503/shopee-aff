import { cn } from "@/lib/utils"

/**
 * The bot has a face on Zalo. On the website it had none.
 *
 * That gap is what made the site read as a spreadsheet: someone chats
 * with something that says "Chao ban!" and taps a link into a grid of
 * boxes. Same product, two personalities, and the colder one is the one
 * holding their money.
 *
 * Drawn inline rather than loaded: it has to take the theme colour, it
 * has to work before any network request finishes, and an image file
 * for eleven shapes is a request nobody should wait for.
 */
export function Mascot({
  className,
  mood = "happy",
}: {
  className?: string
  mood?: "happy" | "waiting" | "celebrating"
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-16", className)}
      role="presentation"
      aria-hidden="true"
    >
      {/* antenna */}
      <line
        x1="32" y1="6" x2="32" y2="13"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        className="text-primary"
      />
      <circle cx="32" cy="5" r="3.5" className="fill-success" />

      {/* head */}
      <rect
        x="9" y="13" width="46" height="38" rx="13"
        className="fill-primary-soft stroke-primary"
        strokeWidth="2.5"
      />

      {/* eyes: open when happy, a soft arc while waiting */}
      {mood === "waiting" ? (
        <>
          <path d="M18 31q4.5 -5 9 0" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" className="text-primary" />
          <path d="M37 31q4.5 -5 9 0" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" className="text-primary" />
        </>
      ) : (
        <>
          <circle cx="22.5" cy="30" r="4" className="fill-primary" />
          <circle cx="41.5" cy="30" r="4" className="fill-primary" />
          <circle cx="24" cy="28.5" r="1.4" className="fill-card" />
          <circle cx="43" cy="28.5" r="1.4" className="fill-card" />
        </>
      )}

      {/* mouth */}
      {mood === "celebrating" ? (
        <path
          d="M24 38 q8 9 16 0 z"
          className="fill-success stroke-success"
          strokeWidth="2" strokeLinejoin="round"
        />
      ) : (
        <path
          d="M25 39 q7 6 14 0"
          fill="none" stroke="currentColor" strokeWidth="3"
          strokeLinecap="round" className="text-primary"
        />
      )}

      {/* a coin, because this is the one thing it does */}
      <circle cx="50" cy="47" r="9" className="fill-warning-soft stroke-warning"
              strokeWidth="2.5" />
      <text
        x="50" y="51.5" textAnchor="middle"
        className="fill-warning"
        style={{ font: "700 10px system-ui, sans-serif" }}
      >
        $
      </text>
    </svg>
  )
}
