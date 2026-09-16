import { cn } from "@/lib/utils"

/**
 * The bot has a face on Zalo. On the website it had none.
 *
 * That gap is what made the site read as a spreadsheet: someone chats
 * with something that says "Chao ban!" and taps a link into a grid of
 * boxes. Same product, two personalities, and the colder one is the one
 * holding their money.
 *
 * ALIVE, NOT ANIMATED
 * -------------------
 * A drawing that never moves is a logo; this has to read as somebody
 * waiting for you. So it breathes, it blinks on its own, and its
 * antenna light pulses -- all in CSS, on their own clocks, so nothing
 * re-renders and nothing has to be told to start.
 *
 * The motion is deliberately soft and slightly overshooting rather than
 * linear. Linear easing is what makes a thing look mechanical, which is
 * the one impression a robot drawing least needs help with.
 *
 * COVERING ITS EYES
 * -----------------
 * `shy` puts its hands over its eyes while a password is being typed,
 * and `peeking` lowers one when the reader chooses to show what they
 * typed. It is a joke, but it does something real: the password is
 * eight random characters the bot sent over Zalo, most people are
 * copying it in by thumb, and a screen that visibly is not looking
 * makes typing it on a bus feel different from typing it into a form.
 *
 * Drawn inline rather than loaded: it takes the theme colour, it works
 * before any request finishes, and an image file for a dozen shapes is
 * a round trip nobody should wait for.
 */
export type Mood = "happy" | "waiting" | "celebrating" | "shy" | "peeking"

export function Mascot({
  className,
  mood = "happy",
}: {
  className?: string
  mood?: Mood
}) {
  const hiding = mood === "shy" || mood === "peeking"
  const eyesShut = mood === "shy" || mood === "waiting"

  return (
    <svg
      viewBox="0 0 64 70"
      className={cn("mascot size-16", className)}
      data-mood={mood}
      role="presentation"
      aria-hidden="true"
    >
      <g className="mascot-body">
        {/* antenna, with a light that keeps its own time */}
        <path
          d="M32 14 q0 -5 0 -7"
          stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          fill="none" className="text-primary"
        />
        <circle cx="32" cy="4.5" r="3.5" className="mascot-blip fill-success" />

        {/* head: rounder than it needs to be, on purpose */}
        <rect
          x="8" y="13" width="48" height="39" rx="17"
          className="fill-primary-soft stroke-primary"
          strokeWidth="2.5"
        />

        {/* cheeks */}
        <ellipse cx="16.5" cy="38" rx="3.6" ry="2.6"
                 className="fill-warning" opacity="0.38" />
        <ellipse cx="47.5" cy="38" rx="3.6" ry="2.6"
                 className="fill-warning" opacity="0.38" />

        {/* eyes: open ones blink on their own */}
        {eyesShut ? (
          <>
            <path d="M18 31q5 -5.5 10 0" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" className="text-primary" />
            <path d="M36 31q5 -5.5 10 0" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" className="text-primary" />
          </>
        ) : (
          <g className="mascot-eyes">
            <circle cx="23" cy="30" r="4.2" className="fill-primary" />
            <circle cx="41" cy="30" r="4.2" className="fill-primary" />
            <circle cx="24.6" cy="28.4" r="1.5" className="fill-card" />
            <circle cx="42.6" cy="28.4" r="1.5" className="fill-card" />
          </g>
        )}

        {/* mouth */}
        {mood === "celebrating" ? (
          <path d="M24 39 q8 9.5 16 0 z"
                className="fill-success stroke-success"
                strokeWidth="2" strokeLinejoin="round" />
        ) : mood === "peeking" ? (
          <ellipse cx="32" cy="41" rx="3.4" ry="2.6" className="fill-primary" />
        ) : (
          <path d="M25.5 39.5 q6.5 6 13 0" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" className="text-primary" />
        )}

        {/* the coin, because this is the one thing it does */}
        <g className="mascot-coin">
          <circle cx="51" cy="48" r="9"
                  className="fill-warning-soft stroke-warning" strokeWidth="2.5" />
          <text x="51" y="52.5" textAnchor="middle" className="fill-warning"
                style={{ font: "700 10px system-ui, sans-serif" }}>
            $
          </text>
        </g>

        {/* hands: parked below, swung over the eyes when hiding */}
        <g className="mascot-hand" data-state={hiding ? "up" : "down"}>
          <Paw peek={mood === "peeking"} />
        </g>
        <g className="mascot-hand" data-state={hiding ? "up" : "down"}>
          <Paw right />
        </g>
      </g>
    </svg>
  )
}

function Paw({ right = false, peek = false }: { right?: boolean; peek?: boolean }) {
  const x = right ? 37 : 12
  return (
    <g
      className={right ? undefined : "mascot-hand-left"}
      data-state={peek ? "peek" : undefined}
    >
      <rect x={x + 3.5} y="31" width="8" height="28" rx="4"
            className="fill-primary-soft stroke-primary" strokeWidth="2.5" />
      <circle cx={x + 7.5} cy="31.5" r="7.8"
              className="fill-primary-soft stroke-primary" strokeWidth="2.5" />
    </g>
  )
}
