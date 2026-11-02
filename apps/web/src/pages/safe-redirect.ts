/** Only a path inside this site, never another site; anything else is dropped. */
export function safeRedirect(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : undefined;
}
