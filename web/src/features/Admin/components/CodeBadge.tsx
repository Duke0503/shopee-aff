import * as React from "react"
import { Copy, Check } from "lucide-react"

export interface CodeBadgeProps {
  /** The code or ID string to display and copy */
  code?: string | number | null
  /** Optional prefix label, e.g. "ID:", "STK:", "Zalo:" */
  label?: string
  /** Optional icon to render on the left */
  icon?: React.ReactNode
  /** If provided, truncates visible string to this length and adds '...' (full text is still copied) */
  truncateLength?: number
  /** Custom className for the container badge */
  className?: string
  /** Whether the copy button is visible. Defaults to true */
  copyable?: boolean
  /** Tooltip or title text (defaults to full code) */
  title?: string
  /** Color variant: default, emerald, blue, amber, purple, primary */
  variant?: "default" | "emerald" | "blue" | "amber" | "purple" | "primary"
}

export function CodeBadge({
  code,
  label,
  icon,
  truncateLength,
  className = "",
  copyable = true,
  title,
  variant = "default",
}: CodeBadgeProps) {
  const [copied, setCopied] = React.useState(false)

  if (code === null || code === undefined || code === "") {
    return <span className="text-muted-foreground/40 font-mono text-[11px] select-none">--</span>
  }

  const str = String(code).trim()
  const displayStr =
    truncateLength && str.length > truncateLength
      ? `${str.slice(0, truncateLength)}...`
      : str

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!str) return
    navigator.clipboard.writeText(str)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const variantStyles = {
    default: "border-border/70 bg-secondary/40 text-foreground hover:border-primary/40 hover:bg-secondary/70",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/20",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:border-blue-500/50 hover:bg-blue-500/20",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/20",
    purple: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:border-purple-500/50 hover:bg-purple-500/20",
    primary: "border-primary/30 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/20",
  }[variant]

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-all max-w-full group shrink-0 ${variantStyles} ${className}`}
      title={title || str}
    >
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      {label && (
        <span className="text-muted-foreground text-[10px] font-sans font-medium select-none shrink-0">
          {label}
        </span>
      )}
      <span className="truncate select-all leading-none">{displayStr}</span>
      {copyable && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Sao chép ${str}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-background/80 transition-colors cursor-pointer"
          title={copied ? "Đã sao chép!" : "Sao chép"}
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      )}
    </div>
  )
}
