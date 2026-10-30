import type { Env } from "./routing";

/**
 * Settings for one assistant run, read from the environment. No secret has a
 * fallback here: a fallback in a public repository is a public secret, so a
 * missing one stops the run instead of quietly using a placeholder.
 */
export interface AssistantConfig {
  serverUrl: string;
  internalUrl: string;
  assistantToken: string;
  zaloCookie: string;
  env: Env;
  mainGroupId: string;
  listenGroupIds: string[];
  minGapMs: number;
  friendRequests: { minGapMs: number; maxPerRun: number };
  ratePercent: string;
  attributionDays: number;
  messagesPath: string;
  notificationPort: number;
  notificationHost: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a number`);
  return value;
}

function groupList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  return {
    serverUrl: required(env, "ASSISTANT_SERVER_URL"),
    internalUrl: required(env, "ASSISTANT_INTERNAL_URL"),
    assistantToken: required(env, "ASSISTANT_TOKEN"),
    zaloCookie: required(env, "ZALO_COOKIE"),
    env: env.ASSISTANT_ENV === "production" ? "production" : "dev",
    mainGroupId: required(env, "MAIN_GROUP_ID"),
    listenGroupIds: groupList(env.LISTEN_GROUP_IDS),
    minGapMs: asInt(env, "MESSAGE_MIN_GAP_MS", 1000),
    friendRequests: {
      minGapMs: asInt(env, "FRIEND_MIN_GAP_MS", 60_000),
      maxPerRun: asInt(env, "FRIEND_MAX_PER_RUN", 20),
    },
    ratePercent: env.CASHBACK_RATE_PERCENT ?? "80",
    attributionDays: asInt(env, "LINK_ATTRIBUTION_DAYS", 7),
    messagesPath: env.MESSAGES_PATH ?? "resources/messages.vi.json",
    notificationPort: asInt(env, "NOTIFICATION_PORT", 8891),
    notificationHost: env.NOTIFICATION_HOST ?? "127.0.0.1",
  };
}
