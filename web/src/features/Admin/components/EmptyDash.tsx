import * as React from "react"
import { vnd } from "@/lib/format"

export interface EmptyDashProps {
  /** The value to evaluate. If 0, null, undefined, "", "0", "0đ", or "0.00", renders dimmed `--` */
  value?: number | string | null
  /** Format type: 'currency' formats number via vnd(), 'number', or 'text' */
  type?: "currency" | "number" | "text"
  /** Custom className applied when value is active/non-empty */
  className?: string
  /** Custom className applied to the dimmed dash. Defaults to subtle muted monospace */
  dashClassName?: string
  /** Placeholder symbol. Defaults to "--" */
  dash?: string
  /** Optional prefix shown only when value is non-empty */
  prefix?: React.ReactNode
  /** Optional suffix shown only when value is non-empty (e.g. " đơn", " lượt") */
  suffix?: React.ReactNode
  /** Alternative to value, can pass children directly */
  children?: React.ReactNode
}

/**
 * Checks if a given value is considered zero or empty (null, undefined, 0, "0", "0đ", "0.00", "-", etc.)
 */
export function isValueEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true
  if (typeof val === "number") {
    return isNaN(val) || val === 0
  }
  if (typeof val === "string") {
    const trimmed = val.trim().toLowerCase()
    if (trimmed === "" || trimmed === "-" || trimmed === "—" || trimmed === "--") return true
    if (trimmed === "0" || trimmed === "0đ" || trimmed === "0d" || trimmed === "0.00" || trimmed === "0,00") return true
  }
  return false
}

/**
 * Reusable Component across Admin:
 * If value is 0, 0đ, null, empty or undefined, renders a faded/dimmed `--` for visual clarity.
 */
export function EmptyDash({
  value,
  type = "text",
  className,
  dashClassName = "text-muted-foreground/40 font-mono select-none font-normal tracking-tight",
  dash = "--",
  prefix,
  suffix,
  children,
}: EmptyDashProps) {
  const target = value !== undefined ? value : children

  if (isValueEmpty(target)) {
    return <span className={dashClassName}>{dash}</span>
  }

  let formatted: React.ReactNode = target
  if (type === "currency") {
    if (typeof target === "number") {
      formatted = vnd(target)
    } else if (typeof target === "string") {
      const cleaned = target.replace(/[^\d.-]/g, "")
      const num = Number(cleaned)
      if (!isNaN(num) && num !== 0) {
        formatted = vnd(num)
      }
    }
  }

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}

/**
 * Functional helper to return either formatted string or dimmed `--` element
 */
export function renderOrDash(
  val: number | string | null | undefined,
  formatter?: (v: any) => React.ReactNode,
  dash: string = "--",
  dashClassName: string = "text-muted-foreground/40 font-mono select-none font-normal tracking-tight"
): React.ReactNode {
  if (isValueEmpty(val)) {
    return <span className={dashClassName}>{dash}</span>
  }
  return formatter ? formatter(val) : String(val)
}
