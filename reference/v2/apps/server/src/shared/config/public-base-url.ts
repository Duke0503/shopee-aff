/**
 * The site's public address, so a link we put in a chat message is absolute —
 * a bare `/b/<token>` is useless to a customer in Zalo. The same
 * `PUBLIC_BASE_URL` the Python server reads, with the same default, so a link
 * built by either server points at the same place. An empty value means links
 * are left relative.
 */
const DEFAULT_PUBLIC_BASE_URL = "https://hoantiendp.com";

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL).trim().replace(/\/+$/, "");
}

/** An absolute address for a path we send out. */
export function publicUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const base = publicBaseUrl();
  return base === "" ? suffix : `${base}${suffix}`;
}
