/**
 * The only place that reads `process.env` (code.md §9, AD-19). The environment name
 * comes from `CASHBACK_ENV`; everything else, secrets included, comes from the
 * per-environment file `~/.config/cashback/<env>.env`, read once and validated with
 * Zod at startup. A validation error names the keys and never echoes a value.
 *
 * The default data directory is `<repository>/data/<env>`, found from this file's own
 * location and never from the start directory, so every start opens the same ledger and
 * the same lock file. DATA_DIR, when set, must be absolute for the same reason.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

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
  logLevel: LogLevel;
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

function fileSchema(env: Environment) {
  return z.object({
    INTERNAL_TOKEN: z.string().min(32),
    PUBLIC_PORT: port.default(DEFAULT_PORTS[env].public),
    INTERNAL_PORT: port.default(DEFAULT_PORTS[env].internal),
    DATA_DIR: z.string().refine(isAbsolute).optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  });
}

export function configFilePath(env: Environment, home: string = homedir()): string {
  return join(home, ".config", "cashback", `${env}.env`);
}

/** Validates the parsed env file; the error lists key names only. */
export function parseConfig(env: Environment, values: Record<string, string | undefined>): ServerConfig {
  const parsed = fileSchema(env).safeParse(values);
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
    logLevel: file.LOG_LEVEL,
  };
}

function environmentName(raw: string | undefined): Environment {
  const name = raw ?? "dev";
  if (!(ENVIRONMENTS as readonly string[]).includes(name)) throw new ConfigError(`config: CASHBACK_ENV must be one of ${ENVIRONMENTS.join(", ")}`);
  return name as Environment;
}

export function loadConfig(): ServerConfig {
  const env = environmentName(process.env["CASHBACK_ENV"]);
  const path = configFilePath(env);
  if (!existsSync(path)) throw new ConfigError(`config: env file not found: ${path}`);
  return parseConfig(env, parseEnv(readFileSync(path, "utf8")));
}
