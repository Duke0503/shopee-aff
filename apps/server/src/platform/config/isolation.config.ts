/**
 * The startup check that keeps dev away from production (Story 8.1, AD-25, D37, NFR-5). A dev
 * configuration is refused when it points at any production resource: a production port, the
 * live or the new production data, PID or browser-profile folders, a Zalo group other than the
 * Dev group, a production Telegram chat or host name, a public base URL (dev has no tunnel), or a
 * secret shared with the production env file on the same machine, or when the dev env file is the
 * production env file itself. Production is refused when it would run a fake bridge or a fake
 * Zalo client. In every environment the real browser bridge needs its own token (Story 5.3),
 * different from the internal and the assistant tokens.
 *
 * The production identifiers are listed in production-identifiers.json (no secrets). Secrets are
 * only compared, never stored, and a problem names the key and the reason, never a value. This
 * file imports nothing from env.config.ts; env.config.ts turns the problems into a ConfigError.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { hostOnDomain } from "@cashback/core";

import IDENTIFIERS from "./production-identifiers.json" with { type: "json" };

export interface ProductionPath {
  readonly path: string;
  /** True: nothing inside it either; false: only the folder itself (and anything holding it). */
  readonly tree: boolean;
}

export interface ProductionIdentifiers {
  readonly ports: readonly number[];
  readonly paths: readonly ProductionPath[];
  readonly productionZaloGroups: readonly string[];
  readonly devZaloGroups: readonly string[];
  readonly telegramChatIds: readonly string[];
  readonly hostnames: readonly string[];
  readonly zones: readonly string[];
}

/** The part of the server config the check reads (env.config.ts `ServerConfig`). */
export interface IsolationSubject {
  readonly env: "dev" | "prod";
  readonly publicPort: number;
  readonly internalPort: number;
  readonly internalToken: string;
  readonly dataDir: string;
  readonly runDir: string;
  readonly shopeeReportPath: string | null;
  readonly staffAccess: { readonly adminHost: string; readonly accessAudience: string } | null;
  readonly assistantToken: string | null;
  readonly bridgeToken: string | null;
  readonly bridgeMode: "fake" | "browser";
  readonly zaloMode: "fake" | "account" | "relay";
  readonly zaloGroupIds: readonly string[];
  readonly browserProfileDir: string | null;
  readonly telegram: { readonly botToken: string; readonly chatId: string } | null;
  readonly publicBaseUrl: string | null;
  readonly fingerprintKey: string | null;
  readonly accesstradeApiKey: string | null;
  /** ALLOW_PROD_ACCESSTRADE_KEY=1: dev may read the networks' report API with the production key. */
  readonly allowProdAccesstradeKey: boolean;
  /** The live ledger, the read-only source of rehearsals; never the server's own ledger. */
  readonly liveLedgerPath: string | null;
}

export interface IsolationContext {
  readonly identifiers: ProductionIdentifiers;
  /** The production env file's values when it is on this machine, else null. */
  readonly prodEnv: Readonly<Record<string, string | undefined>> | null;
  /** True when the dev env file is the production env file (same path, link or file). */
  readonly devFileIsProdFile: boolean;
  /** Windows paths compare without case. */
  readonly caseInsensitive: boolean;
}

export interface IsolationProblem {
  readonly key: string;
  readonly reason: "production_port" | "production_path" | "production_value" | "not_the_dev_group" | "required" | "must_be_empty" | "same_as_production" | "production_env_file" | "fake_in_production" | "relay_in_production" | "same_as_internal_token" | "same_as_assistant_token" | "own_ledger";
}

/** The committed identifiers with their paths made absolute for this repository and home. */
export function productionIdentifiers(repositoryRoot: string, home: string): ProductionIdentifiers {
  const paths = IDENTIFIERS.paths.map((p): ProductionPath => {
    const path = "absolute" in p && p.absolute ? p.absolute : "repository" in p && p.repository ? join(repositoryRoot, p.repository) : join(home, "home" in p && p.home ? p.home : "");
    return { path, tree: p.tree };
  });
  return {
    ports: IDENTIFIERS.ports.map((p) => p.port),
    paths,
    productionZaloGroups: IDENTIFIERS.zalo.productionGroups.map((g) => g.id),
    devZaloGroups: IDENTIFIERS.zalo.devGroups.map((g) => g.id),
    telegramChatIds: IDENTIFIERS.telegramChats.map((c) => c.id),
    hostnames: IDENTIFIERS.hostnames,
    zones: IDENTIFIERS.zones,
  };
}

const blank = (value: string | undefined): string | null => (value === undefined || value.trim() === "" ? null : value.trim());

/** `id, id` as ZALO_GROUP_IDS writes it; blanks dropped. The one parser of that key. */
export const parseIdList = (text: string | null | undefined): string[] => (text ?? "").split(",").map((id) => id.trim()).filter((id) => id !== "");

/** Two caller tokens must differ (the assistant or the bridge token from the internal one, and from each other), or one would open the other's routes. */
export const tokensClash = (one: string, other: string | null): boolean => other !== null && other === one;

/** The production env file's own ports, folders, groups, chat and host join the committed list. */
function withProductionFile(ids: ProductionIdentifiers, prod: Readonly<Record<string, string | undefined>> | null): ProductionIdentifiers {
  if (prod === null) return ids;
  const value = (key: string) => blank(prod[key]);
  const ports = ["PUBLIC_PORT", "INTERNAL_PORT"].map(value).filter((v): v is string => v !== null).map(Number);
  const dirs = ["DATA_DIR", "RUN_DIR", "BROWSER_PROFILE_DIR"].map(value).filter((v): v is string => v !== null && isAbsolute(v));
  const groups = parseIdList(value("ZALO_GROUP_IDS"));
  const chat = value("TELEGRAM_CHAT_ID");
  const host = value("ADMIN_HOST");
  return {
    ...ids,
    ports: [...ids.ports, ...ports],
    paths: [...ids.paths, ...dirs.map((path) => ({ path, tree: true }))],
    productionZaloGroups: [...ids.productionZaloGroups, ...groups],
    telegramChatIds: chat === null ? ids.telegramChatIds : [...ids.telegramChatIds, chat],
    hostnames: host === null ? ids.hostnames : [...ids.hostnames, host.toLowerCase()],
  };
}

function pathConflicts(dev: string, prod: ProductionPath, caseInsensitive: boolean): boolean {
  const norm = (p: string): string => {
    const r = resolve(p).replaceAll("\\", "/").replace(/\/+$/, "");
    return caseInsensitive ? r.toLowerCase() : r;
  };
  const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}/`);
  const [d, p] = [norm(dev), norm(prod.path)];
  return inside(p, d) || (prod.tree && inside(d, p));
}

const onHost = (host: string, ids: ProductionIdentifiers): boolean => {
  const h = host.toLowerCase();
  return ids.hostnames.includes(h) || hostOnDomain(h, ids.zones);
};

/** Secrets compared with the production env file's values; equal means a copied secret. */
type SharedSecretKey = "INTERNAL_TOKEN" | "ASSISTANT_TOKEN" | "BRIDGE_TOKEN" | "TELEGRAM_BOT_TOKEN" | "ACCESS_AUDIENCE" | "FINGERPRINT_KEY" | "ACCESSTRADE_API_KEY";

function secretsOf(config: IsolationSubject): Record<SharedSecretKey, string | null> {
  return {
    INTERNAL_TOKEN: config.internalToken,
    ASSISTANT_TOKEN: config.assistantToken,
    BRIDGE_TOKEN: config.bridgeToken,
    TELEGRAM_BOT_TOKEN: config.telegram?.botToken ?? null,
    ACCESS_AUDIENCE: config.staffAccess?.accessAudience ?? null,
    // Dev never computes production bank fingerprints; a rehearsal passes the key to its own command.
    FINGERPRINT_KEY: config.fingerprintKey,
    // The report API key may be shared only on purpose (read-only reports for a shadow run).
    ACCESSTRADE_API_KEY: config.allowProdAccesstradeKey ? null : config.accesstradeApiKey,
  };
}

function resourceProblems(config: IsolationSubject, ids: ProductionIdentifiers, ci: boolean): IsolationProblem[] {
  const out: IsolationProblem[] = [];
  const add = (key: string, reason: IsolationProblem["reason"]) => out.push({ key, reason });
  if (ids.ports.includes(config.publicPort)) add("PUBLIC_PORT", "production_port");
  if (ids.ports.includes(config.internalPort)) add("INTERNAL_PORT", "production_port");
  const folders: [string, string | null][] = [["DATA_DIR", config.dataDir], ["RUN_DIR", config.runDir], ["BROWSER_PROFILE_DIR", config.browserProfileDir], ["SHOPEE_REPORT_PATH", config.shopeeReportPath]];
  for (const [key, dir] of folders) if (dir !== null && ids.paths.some((p) => pathConflicts(dir, p, ci))) add(key, "production_path");
  if (config.bridgeMode === "browser" && config.browserProfileDir === null) add("BROWSER_PROFILE_DIR", "required");
  if (config.zaloGroupIds.some((g) => !ids.devZaloGroups.includes(g) || ids.productionZaloGroups.includes(g))) add("ZALO_GROUP_IDS", "not_the_dev_group");
  if (config.zaloMode !== "fake" && config.zaloGroupIds.length === 0) add("ZALO_GROUP_IDS", "required");
  if (config.telegram !== null && ids.telegramChatIds.includes(config.telegram.chatId)) add("TELEGRAM_CHAT_ID", "production_value");
  if (config.publicBaseUrl !== null) add("PUBLIC_BASE_URL", "must_be_empty");
  if (config.staffAccess !== null && onHost(config.staffAccess.adminHost, ids)) add("ADMIN_HOST", "production_value");
  return out;
}

/** Each internal caller has its own token (INV-7): one shared would open the other's routes. */
function tokenProblems(config: IsolationSubject): IsolationProblem[] {
  const out: IsolationProblem[] = [];
  if (tokensClash(config.internalToken, config.assistantToken)) out.push({ key: "ASSISTANT_TOKEN", reason: "same_as_internal_token" });
  if (tokensClash(config.internalToken, config.bridgeToken)) out.push({ key: "BRIDGE_TOKEN", reason: "same_as_internal_token" });
  if (config.assistantToken !== null && tokensClash(config.assistantToken, config.bridgeToken)) out.push({ key: "BRIDGE_TOKEN", reason: "same_as_assistant_token" });
  if (config.bridgeMode === "browser" && config.bridgeToken === null) out.push({ key: "BRIDGE_TOKEN", reason: "required" });
  return out;
}

export function isolationProblems(config: IsolationSubject, context: IsolationContext): IsolationProblem[] {
  const out: IsolationProblem[] = tokenProblems(config);
  if (config.liveLedgerPath !== null && isAbsolute(config.liveLedgerPath) && pathConflicts(config.liveLedgerPath, { path: config.dataDir, tree: true }, context.caseInsensitive)) out.push({ key: "LIVE_LEDGER_PATH", reason: "own_ledger" });
  if (config.env === "prod") {
    if (config.bridgeMode === "fake") out.push({ key: "BRIDGE_MODE", reason: "fake_in_production" });
    if (config.zaloMode === "fake") out.push({ key: "ZALO_MODE", reason: "fake_in_production" });
    // The relay is the assistant's send-only test path to the Dev group (Story 6.3); never production's session.
    if (config.zaloMode === "relay") out.push({ key: "ZALO_MODE", reason: "relay_in_production" });
    // Share links and the share page's hand-off are built on it (Story 5.8); never on a request's own Host.
    if (config.publicBaseUrl === null) out.push({ key: "PUBLIC_BASE_URL", reason: "required" });
    return out;
  }
  if (context.devFileIsProdFile) out.push({ key: "ENV_FILE", reason: "production_env_file" });
  out.push(...resourceProblems(config, withProductionFile(context.identifiers, context.prodEnv), context.caseInsensitive));
  if (context.prodEnv !== null) {
    const prod = context.prodEnv;
    for (const [key, value] of Object.entries(secretsOf(config))) if (value !== null && blank(prod[key]) === value) out.push({ key, reason: "same_as_production" });
  }
  return out;
}

/** What a start should log: a production secret dev was allowed to share. Keys only. */
export function isolationWarnings(config: IsolationSubject, context: IsolationContext): string[] {
  if (config.env !== "dev" || !config.allowProdAccesstradeKey || context.prodEnv === null || config.accesstradeApiKey === null) return [];
  return blank(context.prodEnv["ACCESSTRADE_API_KEY"]) === config.accesstradeApiKey ? ["ACCESSTRADE_API_KEY shared_with_production"] : [];
}

function sameFile(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false;
  if (realpathSync(a) === realpathSync(b)) return true;
  const [sa, sb] = [statSync(a, { bigint: true }), statSync(b, { bigint: true })];
  return sa.ino !== 0n && sa.ino === sb.ino && sa.dev === sb.dev;
}

/** Reads what the check compares against: the production env file next to the dev one, if any. */
export function isolationContext(input: { repositoryRoot: string; home: string; devFile: string; prodFile: string; caseInsensitive: boolean }): IsolationContext {
  return {
    identifiers: productionIdentifiers(input.repositoryRoot, input.home),
    prodEnv: existsSync(input.prodFile) ? parseEnv(readFileSync(input.prodFile, "utf8")) : null,
    devFileIsProdFile: sameFile(input.devFile, input.prodFile),
    caseInsensitive: input.caseInsensitive,
  };
}

/** `KEY (reason)` for each problem, keys only. */
export const describeProblems = (problems: readonly IsolationProblem[]): string => problems.map((p) => `${p.key} (${p.reason})`).join(", ");
