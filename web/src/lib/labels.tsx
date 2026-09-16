import { createContext, useContext, type ReactNode } from "react"

/**
 * Every word on screen comes from resources/dashboard.vi.json.
 *
 * Same rule as the bot's messages: wording is not code. Keeping it out
 * of the components means the operator can reword the site without a
 * rebuild, and it keeps Vietnamese out of the source tree.
 *
 * `defaults` carries the figures that appear inside the wording -- the
 * cashback rate, the reduced rate, the payout window. They are policy,
 * they come from the server, and every label that mentions one must get
 * the same value, so they are substituted for free rather than passed
 * at each call site and forgotten at one of them.
 */
type Labels = Record<string, string>

interface Bag {
  labels: Labels
  defaults: Record<string, string>
}

const LabelContext = createContext<Bag>({ labels: {}, defaults: {} })

export function LabelProvider({
  value,
  defaults = {},
  children,
}: {
  value: Labels
  defaults?: Record<string, string>
  children: ReactNode
}) {
  return <LabelContext value={{ labels: value, defaults }}>{children}</LabelContext>
}

export function useT() {
  const { labels, defaults } = useContext(LabelContext)
  return (key: string, values?: Record<string, string | number>) => {
    let text = labels[key] ?? key
    for (const [name, value] of Object.entries({ ...defaults, ...values })) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
}
