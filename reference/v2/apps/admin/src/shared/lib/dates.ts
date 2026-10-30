/**
 * Dates as Vietnamese readers write them: `05/10/2026`. Times are the server's
 * local-naive strings (`YYYY-MM-DDTHH:MM:SS`), formatted by splitting — never by
 * `new Date(value)`, which would read a naive string as UTC and shift the day.
 */
export function shortDate(value: string | null): string {
  if (value === null) return "";
  const [date] = value.split("T");
  const [year, month, day] = (date ?? "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

/** Date and time: `05/10/2026 09:00`. */
export function shortDateTime(value: string | null): string {
  const date = shortDate(value);
  if (date === "") return "";
  const [, time = ""] = (value ?? "").split("T");
  return `${date} ${time.slice(0, 5)}`.trim();
}
