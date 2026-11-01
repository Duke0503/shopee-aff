/**
 * Who opened a share link, read from the user agent only (FR-6, UX-DR12; Story 5.8), with the
 * markers of the live `share_page.py`. A purchase started inside an app's own browser (Zalo's, a
 * social app's) is not credited, so the share page gets the person out of it first; a link-preview
 * bot gets the page but is not counted as a visit. The user agent is read and dropped: it is never
 * stored or logged (SECURITY_MODEL.md, NFR-6).
 */

export type ShareAgent = "browser" | "in_app" | "bot";
export type ShareDevice = "android" | "ios" | "other";

const IN_APP_MARKERS = ["zalo", "fban", "fbav", "fb_iab", "messenger", "instagram", "line/", "micromessenger", "tiktok", "bytedancewebview", "musical_ly", "; wv)"] as const;
const BOT_MARKERS = ["bot", "crawler", "spider", "facebookexternalhit", "preview", "slurp", "curl", "wget", "python-requests", "headless"] as const;

export function shareAgentOf(userAgent: string | undefined): ShareAgent {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua === "" || !ua.includes("mozilla") || BOT_MARKERS.some((m) => ua.includes(m))) return "bot";
  return IN_APP_MARKERS.some((m) => ua.includes(m)) ? "in_app" : "browser";
}

export function shareDeviceOf(userAgent: string | undefined): ShareDevice {
  const ua = (userAgent ?? "").toLowerCase();
  if (["iphone", "ipad", "ipod"].some((m) => ua.includes(m))) return "ios";
  return ua.includes("android") ? "android" : "other";
}

/**
 * The Android intent that opens `url` in Chrome (the live `android_intent`). When Chrome is not
 * installed, Android opens `fallback` in the app's own browser instead.
 */
export function chromeIntentUrl(url: string, fallback: string): string {
  const target = new URL(url);
  const rest = `${target.host}${target.pathname}${target.search}`;
  return `intent://${rest}#Intent;scheme=${target.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}
