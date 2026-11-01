/**
 * The only place that reads `process.env` (code.md §9, AD-19). The environment name
 * comes from `CASHBACK_ENV`; everything else, secrets included, comes from the
 * per-environment file `~/.config/cashback/<env>.env`, read once and validated with
 * Zod at startup. A validation error names the keys and never echoes a value.
 *
 * The default data directory is `<repository>/data/<env>`, found from this file's own
 * location and never from the start directory, so every start opens the same ledger and
 * the same lock file. DATA_DIR, when set, must be absolute for the same reason.
 *
 * Every load also runs the isolation check of isolation.config.ts (Story 8.1, AD-25): a dev
 * file that points at a production resource, or a production file that runs a fake bridge or
 * Zalo client, stops the start with the offending keys named.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

import { BRIDGE_MODES, type BridgeMode } from "../ports/bridge.port";
import { describeProblems, isolationContext, isolationProblems, isolationWarnings, parseIdList } from "./isolation.config";

function findRepositoryRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root (pnpm-workspace.yaml) not found");
  }
}

export const REPOSITORY_ROOT = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)));

export const ENVIRONMENTS = ["dev", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface ServerConfig {
  env: Environment;
  publicPort: number;
  internalPort: number;
  internalToken: string;
  /** `<repository>/data/<env>` unless the env file sets an absolute DATA_DIR; holds the ledger and the lock file. */
  dataDir: string;
  /** `<repository>/run/<env>` unless RUN_DIR (absolute) is set; the start and stop scripts' PID file (AD-25). */
  runDir: string;
  logLevel: LogLevel;
  /**
   * HMAC key for bank account fingerprints (AD-17), as written in the env file. Not validated
   * here, so a command that does not use it never fails over it; each command that does checks
   * it (the cutover import: fingerprint_key_missing, fingerprint_key_too_short).
   */
  fingerprintKey: string | null;
  /** The live production ledger; the cutover import refuses to run without it, and refuses to read or write it (AD-24). */
  liveLedgerPath: string | null;
  /** AccessTrade API key: the shadow run's optional live source (Story 2.8) and the reconciliation source (Story 3.7); never logged. */
  accesstradeApiKey: string | null;
  /**
   * A saved Shopee report the reconciliation runs read until the browser bridge (Story 5.9) does;
   * without it Shopee is not reconciled. Absolute.
   */
  shopeeReportPath: string | null;
  /** The nightly sweep's pause between day slices (Story 3.8); the job's default when unset. */
  sweepPauseMs: number | null;
  /**
   * The admin desk behind Cloudflare Access (AD-18, D48, Story 4.2): the admin host the staff
   * routes are registered for, the Access team domain that issues the JWT and the application
   * audience tag it must carry. All three or none: without them no staff route exists.
   */
  staffAccess: StaffAccessConfig | null;
  /** The Zalo assistant's token for its internal routes (AD-15); without it those routes answer 401. */
  assistantToken: string | null;
  /**
   * The browser bridge extension's token for its routes (Story 5.3); required with
   * `BRIDGE_MODE=browser`, and different from the internal and assistant tokens.
   */
  bridgeToken: string | null;
  /** `fake` (in-process, dev default) or `browser` (the affiliate Chrome, production; Story 5.3). */
  bridgeMode: BridgeMode;
  /** `fake` (no Zalo session, dev default) or `account` (a real Zalo account, production). */
  zaloMode: ZaloMode;
  /** The Zalo groups the assistant may post to; in dev only the Dev group (Story 8.1). */
  zaloGroupIds: readonly string[];
  /** The affiliate Chrome's profile directory, absolute; dev's is never signed in to production Shopee. */
  browserProfileDir: string | null;
  /** The owner's Telegram alert chat (AD-27); both or none. */
  telegram: { botToken: string; chatId: string } | null;
  /** The public origin links and pages are built on; empty in dev, which has no tunnel (AD-25). */
  publicBaseUrl: string | null;
  /** ALLOW_PROD_ACCESSTRADE_KEY=1: dev may share the production AccessTrade report key (logged as a warning). */
  allowProdAccesstradeKey: boolean;
  /** What the isolation check allowed but a start should log (keys only); filled by `loadConfigFor`. */
  isolationWarnings: readonly string[];
}

export const ZALO_MODES = ["fake", "account"] as const;
export type ZaloMode = (typeof ZALO_MODES)[number];

/** What dev runs when its env file names nothing: no browser, no Zalo session (AD-25, D37). */
const DEFAULT_MODES: Record<Environment, { bridge: BridgeMode; zalo: ZaloMode }> = {
  dev: { bridge: "fake", zalo: "fake" },
  prod: { bridge: "browser", zalo: "account" },
};

export interface StaffAccessConfig {
  adminHost: string;
  /** `<team>.cloudflareaccess.com`; the JWT issuer is `https://<teamDomain>`. */
  accessTeamDomain: string;
  accessAudience: string;
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Dev ports differ from production so both can run on one machine (AD-25). */
const DEFAULT_PORTS: Record<Environment, { public: number; internal: number }> = {
  dev: { public: 9080, internal: 9081 },
  prod: { public: 8080, internal: 8081 },
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const port = z.coerce.number().int().min(1).max(65_535);
/** A bare lowercase host name, no scheme, port or path, as the Host header carries it. */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ACCESS_TEAM_DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const STAFF_ACCESS_KEYS = ["ADMIN_HOST", "ACCESS_TEAM_DOMAIN", "ACCESS_AUDIENCE"] as const;

function staffAccessOf(file: { ADMIN_HOST?: string | undefined; ACCESS_TEAM_DOMAIN?: string | undefined; ACCESS_AUDIENCE?: string | undefined }): StaffAccessConfig | null {
  const missing = STAFF_ACCESS_KEYS.filter((key) => file[key] === undefined);
  if (missing.length === STAFF_ACCESS_KEYS.length) return null;
  // Half a staff setup is a mistake, never a desk without its Access check.
  if (missing.length > 0) throw new ConfigError(`config: missing or invalid ${missing.join(", ")}`);
  return { adminHost: file.ADMIN_HOST ?? "", accessTeamDomain: file.ACCESS_TEAM_DOMAIN ?? "", accessAudience: file.ACCESS_AUDIENCE ?? "" };
}

function telegramOf(file: { TELEGRAM_BOT_TOKEN?: string | undefined; TELEGRAM_CHAT_ID?: string | undefined }): ServerConfig["telegram"] {
  if (file.TELEGRAM_BOT_TOKEN === undefined && file.TELEGRAM_CHAT_ID === undefined) return null;
  if (file.TELEGRAM_BOT_TOKEN === undefined || file.TELEGRAM_CHAT_ID === undefined) throw new ConfigError(`config: missing or invalid ${file.TELEGRAM_BOT_TOKEN === undefined ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_CHAT_ID"}`);
  return { botToken: file.TELEGRAM_BOT_TOKEN, chatId: file.TELEGRAM_CHAT_ID };
}

function fileSchema(env: Environment) {
  return z.object({
    INTERNAL_TOKEN: z.string().min(32),
    PUBLIC_PORT: port.default(DEFAULT_PORTS[env].public),
    INTERNAL_PORT: port.default(DEFAULT_PORTS[env].internal),
    DATA_DIR: z.string().refine(isAbsolute).optional(),
    RUN_DIR: z.string().refine(isAbsolute).optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    FINGERPRINT_KEY: z.string().optional(),
    LIVE_LEDGER_PATH: z.string().optional(),
    ACCESSTRADE_API_KEY: z.string().optional(),
    SHOPEE_REPORT_PATH: z.string().refine(isAbsolute).optional(),
    SWEEP_PAUSE_MS: z.coerce.number().int().min(0).max(600_000).optional(),
    ADMIN_HOST: z.string().regex(HOST_NAME).optional(),
    ACCESS_TEAM_DOMAIN: z.string().regex(ACCESS_TEAM_DOMAIN).optional(),
    ACCESS_AUDIENCE: z.string().regex(/^[A-Za-z0-9]{16,128}$/).optional(),
    ASSISTANT_TOKEN: z.string().min(32).optional(),
    BRIDGE_TOKEN: z.string().min(32).optional(),
    BRIDGE_MODE: z.enum(BRIDGE_MODES).default(DEFAULT_MODES[env].bridge),
    ZALO_MODE: z.enum(ZALO_MODES).default(DEFAULT_MODES[env].zalo),
    // Digits separated by commas; blank entries are dropped by parseIdList.
    ZALO_GROUP_IDS: z.string().regex(/^[\d\s,]+$/).optional(),
    BROWSER_PROFILE_DIR: z.string().refine(isAbsolute).optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/).optional(),
    PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    ALLOW_PROD_ACCESSTRADE_KEY: z.enum(["0", "1"]).optional(),
  });
}

export function configFilePath(env: Environment, home: string = homedir()): string {
  return join(home, ".config", "cashback", `${env}.env`);
}

/** A blank value (`KEY=` or spaces) means the key is unset, so a default or null applies. */
const withoutBlanks = (values: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== ""));

/** Validates the parsed env file; the error lists key names only. */
export function parseConfig(env: Environment, values: Record<string, string | undefined>): ServerConfig {
  const parsed = fileSchema(env).safeParse(withoutBlanks(values));
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new ConfigError(`config: missing or invalid ${keys.join(", ")}`);
  }
  const file = parsed.data;
  return {
    env,
    publicPort: file.PUBLIC_PORT,
    internalPort: file.INTERNAL_PORT,
    internalToken: file.INTERNAL_TOKEN,
    dataDir: file.DATA_DIR ?? join(REPOSITORY_ROOT, "data", env),
    runDir: file.RUN_DIR ?? join(REPOSITORY_ROOT, "run", env),
    logLevel: file.LOG_LEVEL,
    fingerprintKey: file.FINGERPRINT_KEY || null,
    liveLedgerPath: file.LIVE_LEDGER_PATH || null,
    accesstradeApiKey: file.ACCESSTRADE_API_KEY || null,
    shopeeReportPath: file.SHOPEE_REPORT_PATH || null,
    sweepPauseMs: file.SWEEP_PAUSE_MS ?? null,
    staffAccess: staffAccessOf(file),
    assistantToken: file.ASSISTANT_TOKEN ?? null,
    bridgeToken: file.BRIDGE_TOKEN ?? null,
    bridgeMode: file.BRIDGE_MODE,
    zaloMode: file.ZALO_MODE,
    zaloGroupIds: parseIdList(file.ZALO_GROUP_IDS),
    browserProfileDir: file.BROWSER_PROFILE_DIR ?? null,
    telegram: telegramOf(file),
    publicBaseUrl: file.PUBLIC_BASE_URL ?? null,
    allowProdAccesstradeKey: file.ALLOW_PROD_ACCESSTRADE_KEY === "1",
    isolationWarnings: [],
  };
}

function environmentName(raw: string | undefined): Environment {
  const name = raw ?? "dev";
  if (!(ENVIRONMENTS as readonly string[]).includes(name)) throw new ConfigError(`config: CASHBACK_ENV must be one of ${ENVIRONMENTS.join(", ")}`);
  return name as Environment;
}

/** Refuses a dev config that points at production, and production running a fake (Story 8.1). */
export function assertIsolated(config: ServerConfig, home: string = homedir()): ServerConfig {
  const context = isolationContext({ repositoryRoot: REPOSITORY_ROOT, home, devFile: configFilePath("dev", home), prodFile: configFilePath("prod", home), caseInsensitive: process.platform === "win32" });
  const problems = isolationProblems(config, context);
  if (problems.length > 0) throw new ConfigError(`config: ${config.env} must not use ${config.env === "dev" ? "production resources" : "fake clients"}: ${describeProblems(problems)}`);
  return { ...config, isolationWarnings: isolationWarnings(config, context) };
}

/** The `CASHBACK_ENV` this process was started with, or null when it is unset. */
export const requestedEnvironment = (): string | null => process.env["CASHBACK_ENV"] ?? null;

export function loadConfig(): ServerConfig {
  return loadConfigFor(environmentName(process.env["CASHBACK_ENV"]));
}

/** Reads, validates and checks the env file of `env` (Story 8.1). */
export function loadConfigFor(env: Environment): ServerConfig {
  const path = configFilePath(env);
  if (!existsSync(path)) throw new ConfigError(`config: env file not found: ${path}`);
  return assertIsolated(parseConfig(env, parseEnv(readFileSync(path, "utf8"))));
}

/** The environment a child process of a start script gets: this one's, with the environment name fixed. */
export function childEnvironment(env: Environment): Record<string, string | undefined> {
  return { ...process.env, CASHBACK_ENV: env };
}
