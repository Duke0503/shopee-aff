/** Vietnamese money: 1.234.567đ, with a dash for nothing known. */
export function vnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—"
  return `${Math.round(amount).toLocaleString("vi-VN")}đ`
}

/** "2026-09-16T16:27:51+07:00" -> "16/09 16:27" */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
