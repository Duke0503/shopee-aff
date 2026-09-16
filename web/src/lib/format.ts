/**
 * Money and dates, as a Vietnamese reader expects them.
 *
 * The currency mark and the separator are LABELS, not code -- same rule
 * as the Python side, and for the same reason: nothing the reader sees
 * should be spelled out in a source file. `configure` is called once
 * when the labels arrive, and until it does these fall back to plain
 * digits rather than rendering a placeholder.
 */

let currency = ""
let separator = ","
let unknown = "-"

export function configure(labels: Record<string, string>) {
  currency = labels.currency ?? currency
  separator = labels.thousands_separator ?? separator
  unknown = labels.nothing_known ?? unknown
}

export function vnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return unknown
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return grouped + currency
}

/** "2026-09-16T16:27:51+07:00" -> "16/09 16:27" */
export function shortDate(value: string | null | undefined): string {
  if (!value) return unknown
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
