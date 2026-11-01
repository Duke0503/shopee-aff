/**
 * The bridge's two settings, kept in `chrome.storage.local` of the affiliate browser profile and
 * entered once on the options page: the server's internal listener and the bridge token from the
 * server's env file (never in the repository or the build). The server URL must be plain http on
 * 127.0.0.1 with a port and nothing else, so the token can only ever be sent to this machine's
 * internal listener (AD-18, INV-7, INV-9).
 *
 * The profile also keeps the extension's instance id, made once at random: the server binds the job
 * out to it, so a second browser never gets the same job, and this one gets its job back after a
 * restart (Story 5.3 review item 5).
 */
import { BRIDGE_INSTANCE_PATTERN } from "@cashback/contracts";

export interface BridgeSettings {
  /** `http://127.0.0.1:<port>`, no path. */
  readonly serverOrigin: string;
  readonly token: string;
}

/** Settings with this extension's instance id, as every server call needs them. */
export interface ConnectedSettings extends BridgeSettings {
  readonly instance: string;
}

export const SETTINGS_KEYS = ["serverUrl", "token"] as const;
export const INSTANCE_KEY = "instanceId";
const MIN_TOKEN_LENGTH = 32;

/** The origin of a loopback internal listener, or null for anything else. */
export function loopbackOrigin(text: string): string | null {
  const trimmed = text.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "/" && url.pathname !== "")) return null;
  return url.origin;
}

export function parseSettings(stored: Record<string, unknown>): BridgeSettings | null {
  const { serverUrl, token } = stored;
  if (typeof serverUrl !== "string" || typeof token !== "string") return null;
  const serverOrigin = loopbackOrigin(serverUrl);
  const cleanToken = token.trim();
  if (serverOrigin === null || cleanToken.length < MIN_TOKEN_LENGTH || /\s/.test(cleanToken)) return null;
  return { serverOrigin, token: cleanToken };
}

/** The stored instance id, or null when there is none yet (or it is not one). */
export function instanceIdOf(stored: Record<string, unknown>): string | null {
  const id = stored[INSTANCE_KEY];
  return typeof id === "string" && BRIDGE_INSTANCE_PATTERN.test(id) ? id : null;
}

/** A new instance id from 16 random bytes. */
export function newInstanceId(randomBytes: (length: number) => Uint8Array): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}
