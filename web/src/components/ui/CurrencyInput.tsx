import * as React from "react"
import { cn } from "@/lib/utils"
import { formatVndNumber, parseVndNumber } from "@/lib/format"

export interface CurrencyInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value?: number | string | null
  onValueChange?: (val: number) => void
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  suffix?: string
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, value, onValueChange, onChange, suffix, placeholder = "0", ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null)

    // Merge forwarded ref and local ref
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)
    const [displayVal, setDisplayVal] = React.useState<string>(() =>
      value !== undefined && value !== null && value !== "" ? formatVndNumber(value) : ""
    )

    // Sync external value changes
    React.useEffect(() => {
      if (value === undefined || value === null || value === "") {
        setDisplayVal("")
      } else {
        const formatted = formatVndNumber(value)
        setDisplayVal(formatted)
      }
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const originalValue = input.value
      const cursorPos = input.selectionStart || 0

      // Count digits before cursor in original string
      const digitsBeforeCursor = originalValue.slice(0, cursorPos).replace(/\D/g, "").length

      // Format new value with commas
      const numericVal = parseVndNumber(originalValue)
      const formatted = originalValue.trim() === "" ? "" : formatVndNumber(numericVal)

      setDisplayVal(formatted)
      if (onValueChange) {
        onValueChange(numericVal)
      }
      if (onChange) {
        onChange(e)
      }

      // Restore cursor position based on digit count
      requestAnimationFrame(() => {
        if (!inputRef.current) return
        let newPos = 0
        let countedDigits = 0
        for (let i = 0; i < formatted.length; i++) {
          if (/\d/.test(formatted[i])) {
            countedDigits++
          }
          if (countedDigits === digitsBeforeCursor) {
            newPos = i + 1
            break
          }
        }
        if (countedDigits < digitsBeforeCursor) {
          newPos = formatted.length
        }
        inputRef.current.setSelectionRange(newPos, newPos)
      })
    }

    return (
      <div className="relative flex items-center w-full">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={displayVal}
          onChange={handleChange}
          placeholder={placeholder}
          className={cn(
            "bg-card ring-offset-background placeholder:text-muted-foreground/60 focus-visible:ring-[var(--ring)]/25 flex h-7.5 w-full rounded-md border border-border/80 px-2.5 py-1 text-[11px] font-mono focus-visible:ring-1 focus-visible:border-primary/50 focus-visible:outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50 shadow-2xs",
            suffix && "pr-6",
            className
          )}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 text-[10px] font-semibold text-muted-foreground select-none">
            {suffix}
          </span>
        )}
      </div>
    )
  }
)

CurrencyInput.displayName = "CurrencyInput"
