/**
 * The only place in the assistant that reads `process.env` (code.md section 9, AD-19). Like the server,
 * the environment name comes from `CASHBACK_ENV` and everything else from the per-environment file
 * `~/.config/cashback/<env>.env`, read once and validated with Zod; an error names keys, never a
 * value. The assistant shares that file with the server: the same ASSISTANT_TOKEN, INTERNAL_PORT,
 * ZALO_MODE and ZALO_GROUP_IDS.
 *
 * Dev isolation (AD-25, D37): dev runs the fake Zalo session unless `ZALO_MODE=account`; then it
 * needs its own ZALO_CREDENTIALS_PATH, which must not be the production credentials (the live
 * assistant's folder, a production folder of production-identifiers.json, or the production env
 * file's ZALO_CREDENTIALS_PATH), and its groups may only be the Dev group. Production never runs
 * the fake session. `ZALO_MODE=relay` (send-only to the Dev group through the live bot,
 * relay-zalo.adapter.ts) is dev only, needs LIVE_BOT_TOKEN and exactly one group, the Dev group.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

import type { HumanDelay } from "./pacer";
import { FRIEND_REQUESTS_PER_VN_DAY } from "./friend-request";
import { ZALO_MODES, type ZaloMode } from "./zalo.port";

export const ENVIRONMENTS = ["dev", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface AssistantConfig {
  readonly env: Environment;
  /** `http://127.0.0.1:<INTERNAL_PORT>`, the server's internal listener. */
  readonly internalBaseUrl: string;
  readonly assistantToken: string;
  readonly zaloMode: ZaloMode;
  /** The only groups the session may write to or listen to. */
  readonly zaloGroupIds: readonly string[];
  /** The Zalo session file; set exactly when `zaloMode` is `account`. */
  readonly zaloCredentialsPath: string | null;
  /** The live bot's broadcast token; set exactly when `zaloMode` is `relay`. */
  readonly liveBotToken: string | null;
  readonly sendDelay: HumanDelay;
  readonly friendRequestsPerDay: number;
  /** The assistant's own folder for its small state files (AD-15); never the server's ledger. */
  readonly dataDir: string;
  readonly logLevel: LogLevel;
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULTS: Record<Environment, { internalPort: number; zalo: ZaloMode }> = {
  dev: { internalPort: 9081, zalo: "fake" },
  prod: { internalPort: 8081, zalo: "account" },
};

/** The live system's delays were 3 to 12 s; nothing below 3 s is a human pace. */
export const MIN_SEND_DELAY_MS = 3_000;
const MAX_SEND_DELAY_MS = 120_000;

/** What the dev checks compare against; built by `isolationFor` from the committed identifiers. */
export interface AssistantIsolation {
  readonly devGroupIds: readonly string[];
  readonly productionPorts: readonly number[];
  /** A credentials path equal to `path`, or inside it when `tree`, is production's. */
  readonly productionPaths: readonly { readonly path: string; readonly tree: boolean }[];
  readonly caseInsensitive: boolean;
}

export class AssistantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantConfigError";
  }
}

const port = z.coerce.number().int().min(1).max(65_535);
const ms = z.coerce.number().int().min(MIN_SEND_DELAY_MS).max(MAX_SEND_DELAY_MS);

function fileSchema(env: Environment) {
  return z.object({
    ASSISTANT_TOKEN: z.string().min(32),
    INTERNAL_PORT: port.default(DEFAULTS[env].internalPort),
    ZALO_MODE: z.enum(ZALO_MODES).default(DEFAULTS[env].zalo),
    ZALO_GROUP_IDS: z.string().regex(/^[\d\s,]+$/).optional(),
    ZALO_CREDENTIALS_PATH: z.string().refine(isAbsolute).optional(),
    LIVE_BOT_TOKEN: z.string().min(16).optional(),
    ASSISTANT_DATA_DIR: z.string().refine(isAbsolute).optional(),
    ASSISTANT_SEND_DELAY_MIN_MS: ms.default(6_000),
    ASSISTANT_SEND_DELAY_MAX_MS: ms.default(12_000),
    ASSISTANT_FRIEND_REQUESTS_PER_DAY: z.coerce.number().int().min(0).max(FRIEND_REQUESTS_PER_VN_DAY).default(FRIEND_REQUESTS_PER_VN_DAY),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  });
}

const idList = (raw: string | undefined): string[] => [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""))];
const withoutBlanks = (values: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== ""));

export function isInsidePath(candidate: string, root: { path: string; tree: boolean }, caseInsensitive: boolean): boolean {
  const norm = (p: string) => {
    const r = resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
    return caseInsensitive ? r.toLowerCase() : r;
  };
  const [c, r] = [norm(candidate), norm(root.path)];
  return c === r || (root.tree && c.startsWith(`${r}/`));
}

function isolationProblems(config: AssistantConfig, internalPort: number, isolation: AssistantIsolation): string[] {
  if (config.env === "prod") return config.zaloMode === "account" ? [] : [`ZALO_MODE (${config.zaloMode} in production)`];
  const problems: string[] = [];
  if (config.zaloMode === "relay" && config.zaloGroupIds.length !== 1) problems.push("ZALO_GROUP_IDS (relay needs exactly the Dev group)");
  if (isolation.productionPorts.includes(internalPort)) problems.push("INTERNAL_PORT (production port)");
  if (config.zaloGroupIds.some((id) => !isolation.devGroupIds.includes(id))) problems.push("ZALO_GROUP_IDS (not the Dev group)");
  const path = config.zaloCredentialsPath;
  if (path !== null && isolation.productionPaths.some((root) => isInsidePath(path, root, isolation.caseInsensitive))) problems.push("ZALO_CREDENTIALS_PATH (production credentials)");
  if (isolation.productionPaths.some((root) => isInsidePath(config.dataDir, { path: root.path, tree: true }, isolation.caseInsensitive))) problems.push("ASSISTANT_DATA_DIR (production folder)");
  return problems;
}

/** Validates the env file's values; the error lists key names only. */
export function parseAssistantConfig(env: Environment, values: Readonly<Record<string, string | undefined>>, isolation: AssistantIsolation): AssistantConfig {
  const parsed = fileSchema(env).safeParse(withoutBlanks(values));
  if (!parsed.success) throw new AssistantConfigError(`assistant config: missing or invalid ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  const file = parsed.data;
  if (file.ASSISTANT_SEND_DELAY_MAX_MS < file.ASSISTANT_SEND_DELAY_MIN_MS) throw new AssistantConfigError("assistant config: missing or invalid ASSISTANT_SEND_DELAY_MAX_MS");
  if (file.ZALO_MODE === "account" && file.ZALO_CREDENTIALS_PATH === undefined) throw new AssistantConfigError("assistant config: missing or invalid ZALO_CREDENTIALS_PATH");
  if (file.ZALO_MODE === "relay" && file.LIVE_BOT_TOKEN === undefined) throw new AssistantConfigError("assistant config: missing or invalid LIVE_BOT_TOKEN");
  const config: AssistantConfig = {
    env,
    internalBaseUrl: `http://127.0.0.1:${file.INTERNAL_PORT}`,
    assistantToken: file.ASSISTANT_TOKEN,
    zaloMode: file.ZALO_MODE,
    zaloGroupIds: idList(file.ZALO_GROUP_IDS),
    zaloCredentialsPath: file.ZALO_MODE === "account" ? (file.ZALO_CREDENTIALS_PATH ?? null) : null,
    liveBotToken: file.ZALO_MODE === "relay" ? (file.LIVE_BOT_TOKEN ?? null) : null,
    sendDelay: { minMs: file.ASSISTANT_SEND_DELAY_MIN_MS, maxMs: file.ASSISTANT_SEND_DELAY_MAX_MS },
    friendRequestsPerDay: file.ASSISTANT_FRIEND_REQUESTS_PER_DAY,
    dataDir: file.ASSISTANT_DATA_DIR ?? join(REPOSITORY_ROOT, "data", env, "assistant"),
    logLevel: file.LOG_LEVEL,
  };
  const problems = isolationProblems(config, file.INTERNAL_PORT, isolation);
  if (problems.length > 0) throw new AssistantConfigError(`assistant config: ${env} must not use ${problems.join(", ")}`);
  return config;
}

function findRepositoryRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new AssistantConfigError("repository root (pnpm-workspace.yaml) not found");
  }
}

export const REPOSITORY_ROOT = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)));
/** The one list of production identifiers (Story 8.1), owned by the server's config; read as data, never imported. */
const identifiersFile = (repositoryRoot: string): string => join(repositoryRoot, "apps", "server", "src", "platform", "config", "production-identifiers.json");

const identifiersSchema = z.object({
  ports: z.array(z.object({ port: z.number() })),
  paths: z.array(z.object({ absolute: z.string().optional(), repository: z.string().optional(), home: z.string().optional(), tree: z.boolean() })),
  zalo: z.object({ devGroups: z.array(z.object({ id: z.string() })) }),
});

export const configFilePath = (env: Environment, home: string): string => join(home, ".config", "cashback", `${env}.env`);

/** The dev checks for this repository and home: committed identifiers, the live assistant folder, and production's own credentials path. */
export function isolationFor(repositoryRoot: string, home: string, prodEnv: Readonly<Record<string, string | undefined>> | null, caseInsensitive: boolean): AssistantIsolation {
  const ids = identifiersSchema.parse(JSON.parse(readFileSync(identifiersFile(repositoryRoot), "utf8")));
  const paths = ids.paths.flatMap((p) => {
    const where = p.absolute ?? (p.repository !== undefined ? join(repositoryRoot, p.repository) : p.home !== undefined ? join(home, p.home) : null);
    return where === null ? [] : [{ path: where, tree: p.tree }];
  });
  // The live assistant keeps its Zalo session in zalo_assistant/credentials.json in this same folder.
  paths.push({ path: join(repositoryRoot, "zalo_assistant"), tree: true });
  const prodCredentials = prodEnv?.["ZALO_CREDENTIALS_PATH"]?.trim();
  if (prodCredentials) paths.push({ path: prodCredentials, tree: false });
  return { devGroupIds: ids.zalo.devGroups.map((g) => g.id), productionPorts: ids.ports.map((p) => p.port), productionPaths: paths, caseInsensitive };
}

function environmentName(raw: string | undefined): Environment {
  const name = raw ?? "dev";
  if (!(ENVIRONMENTS as readonly string[]).includes(name)) throw new AssistantConfigError(`assistant config: CASHBACK_ENV must be one of ${ENVIRONMENTS.join(", ")}`);
  return name as Environment;
}

export function loadAssistantConfig(home: string = homedir()): AssistantConfig {
  const env = environmentName(process.env["CASHBACK_ENV"]);
  const path = configFilePath(env, home);
  if (!existsSync(path)) throw new AssistantConfigError(`assistant config: env file not found: ${path}`);
  const prodPath = configFilePath("prod", home);
  const prodEnv = env === "dev" && existsSync(prodPath) ? parseEnv(readFileSync(prodPath, "utf8")) : null;
  return parseAssistantConfig(env, parseEnv(readFileSync(path, "utf8")), isolationFor(REPOSITORY_ROOT, home, prodEnv, process.platform === "win32"));
}
