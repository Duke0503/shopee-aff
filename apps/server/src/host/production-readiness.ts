/**
 * The production settings go-live needs (Story 8.5; AD-18, AD-26, AD-27, AD-29): the env file
 * loads without them (each part of the server starts without its own), so the preflight
 * `pnpm host check --env prod` names every one still missing. Key names only.
 */
import type { ServerConfig } from "../platform/config/env.config";

type Readiness = Pick<ServerConfig, "staffAccess" | "telegram" | "heartbeatUrl" | "backupOffsite" | "assistantToken" | "bridgeToken" | "browserProfileDir" | "publicBaseUrl" | "fingerprintKey"> &
  Partial<Pick<ServerConfig, "backupOffsiteKind" | "backupDriveWebhook" | "backupEncryptionKey">>;

/**
 * The off-site copy (AD-26; owner decision 2026-11-03): age and rclone, or the Google Drive webhook
 * with its encryption key. Missing, it names the webhook keys still unset, the setup the owner chose.
 */
function offsiteGap(c: Readiness): string | null {
  const kind = c.backupOffsiteKind ?? (c.backupOffsite !== null ? "rclone" : null);
  if (kind === "rclone") return c.backupOffsite !== null ? null : "BACKUP_AGE_PATH, BACKUP_AGE_RECIPIENT, BACKUP_RCLONE_PATH, BACKUP_RCLONE_REMOTE";
  if (c.backupDriveWebhook) return null;
  return [kind === "drive_webhook" ? null : "GDRIVE_WEBHOOK_URL", c.backupEncryptionKey ? null : "BACKUP_ENCRYPTION_KEY"].filter((k) => k !== null).join(", ");
}

/** Each entry: the keys named while missing (null: nothing missing). */
const NEEDED: readonly ((config: Readiness) => string | null)[] = [
  (c) => (c.publicBaseUrl !== null ? null : "PUBLIC_BASE_URL"),
  (c) => (c.staffAccess !== null ? null : "ADMIN_HOST, ACCESS_TEAM_DOMAIN, ACCESS_AUDIENCE"),
  (c) => (c.telegram !== null ? null : "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID"),
  (c) => (c.heartbeatUrl !== null ? null : "HEARTBEAT_URL"),
  offsiteGap,
  (c) => (c.assistantToken !== null ? null : "ASSISTANT_TOKEN"),
  (c) => (c.bridgeToken !== null ? null : "BRIDGE_TOKEN"),
  (c) => (c.browserProfileDir !== null ? null : "BROWSER_PROFILE_DIR"),
  (c) => (c.fingerprintKey !== null && c.fingerprintKey.length >= 32 ? null : "FINGERPRINT_KEY"),
];

/** The settings still missing, by key. */
export const productionGaps = (config: Readiness): string[] => NEEDED.map((gap) => gap(config)).filter((keys): keys is string => keys !== null && keys !== "");
