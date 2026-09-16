import { createContext, useContext, type ReactNode } from "react"

/**
 * Every word on screen comes from resources/dashboard.vi.json.
 *
 * Same rule as the bot's messages: wording is not code. Keeping it out
 * of the components means the operator can reword the console without
 * a rebuild, and it keeps Vietnamese out of the source tree.
 */
type Labels = Record<string, string>

const LabelContext = createContext<Labels>({})

export function LabelProvider({
  value,
  children,
}: {
  value: Labels
  children: ReactNode
}) {
  return <LabelContext value={value}>{children}</LabelContext>
}

export function useT() {
  const labels = useContext(LabelContext)
  return (key: string, values?: Record<string, string | number>) => {
    let text = labels[key] ?? key
    if (values) {
      for (const [name, value] of Object.entries(values)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}
