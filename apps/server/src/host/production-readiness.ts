/**
 * The production settings go-live needs (Story 8.5; AD-18, AD-26, AD-27, AD-29): the env file
 * loads without them (each part of the server starts without its own), so the preflight
 * `pnpm host check --env prod` names every one still missing. Key names only.
 */
import type { ServerConfig } from "../platform/config/env.config";

type Readiness = Pick<ServerConfig, "staffAccess" | "telegram" | "heartbeatUrl" | "backupOffsite" | "assistantToken" | "bridgeToken" | "browserProfileDir" | "publicBaseUrl" | "fingerprintKey">;

const NEEDED: readonly (readonly [string, (config: Readiness) => boolean])[] = [
  ["PUBLIC_BASE_URL", (c) => c.publicBaseUrl !== null],
  ["ADMIN_HOST, ACCESS_TEAM_DOMAIN, ACCESS_AUDIENCE", (c) => c.staffAccess !== null],
  ["TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", (c) => c.telegram !== null],
  ["HEARTBEAT_URL", (c) => c.heartbeatUrl !== null],
  ["BACKUP_AGE_PATH, BACKUP_AGE_RECIPIENT, BACKUP_RCLONE_PATH, BACKUP_RCLONE_REMOTE", (c) => c.backupOffsite !== null],
  ["ASSISTANT_TOKEN", (c) => c.assistantToken !== null],
  ["BRIDGE_TOKEN", (c) => c.bridgeToken !== null],
  ["BROWSER_PROFILE_DIR", (c) => c.browserProfileDir !== null],
  ["FINGERPRINT_KEY", (c) => c.fingerprintKey !== null && c.fingerprintKey.length >= 32],
];

/** The settings still missing, by key. */
export const productionGaps = (config: Readiness): string[] => NEEDED.filter(([, present]) => !present(config)).map(([keys]) => keys);
