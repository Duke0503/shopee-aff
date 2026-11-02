/**
 * The cutover's preflight on the production host (Story 8.8): the checks of `pnpm host check`
 * (production settings, no secret committed on `main`, none shared with the live `.env`, D51)
 * read with the owner's two cutover exceptions. A setting still missing is accepted only when the
 * carry-over will fill it from the live `.env` or the owner named it on the command line (the admin
 * host and Access before Cloudflare Access exists); a secret shared with the live `.env` is
 * accepted only for the two carried keys, and only when their live values were never committed on
 * `main` either. The builds the new server serves must be present. Key and file names only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { productionGaps } from "../host/production-readiness";
import { blobsOf, existingRef, gitIn, keysFoundIn, keysSharedWith, searchedSecrets } from "../host/secrets-check";
import { configFilePath, loadConfigFor, REPOSITORY_ROOT } from "../platform/config/env.config";
import { CARRIED_SECRET_KEYS, planCarryOver } from "./env-carry-over";

/** What the new server serves and loads: the builds made on the operator's machine, and the installed SQLite binding. */
export const REQUIRED_BUILDS = ["apps/web/dist/index.html", "apps/admin/dist/index.html", "apps/bridge/dist/manifest.json", "apps/server/node_modules/better-sqlite3/package.json"] as const;

export interface PreflightFacts {
  /** productionGaps groups, such as "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID". */
  readonly gaps: readonly string[];
  /** Keys whose production value is in `main`'s history; null when `main` was not found. */
  readonly committed: readonly string[] | null;
  /** Keys whose production value equals a live `.env` value. */
  readonly shared: readonly string[];
  /** Keys the carry-over will write or already holds from the live `.env`. */
  readonly carried: readonly string[];
  /** Carried live secrets whose value is in `main`'s history. */
  readonly carriedCommitted: readonly string[];
  readonly acceptedGaps: readonly string[];
  readonly missingBuilds: readonly string[];
}

export interface PreflightVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** Gap keys accepted, so the go-live runbook lists them as owner steps still open. */
  readonly openGaps: readonly string[];
}

const keysOf = (group: string): string[] => group.split(",").map((k) => k.trim()).filter((k) => k !== "");

export function preflightVerdict(facts: PreflightFacts): PreflightVerdict {
  const problems: string[] = [];
  const openGaps: string[] = [];
  const covered = new Set([...facts.carried, ...facts.acceptedGaps]);
  for (const group of facts.gaps) {
    const keys = keysOf(group);
    if (keys.every((k) => covered.has(k))) openGaps.push(...keys.filter((k) => !facts.carried.includes(k)));
    else problems.push(`settings_missing:${keys.filter((k) => !covered.has(k)).join("+")}`);
  }
  if (facts.committed === null) problems.push("secrets_unchecked:main_ref_not_found");
  else for (const key of facts.committed) problems.push(`secrets_committed:${key}`);
  // The owner may keep a carried key whose live value was committed on main (2026-11-02 decision:
  // keep the existing Telegram bot); it must be named in the accepted list and is reported.
  for (const key of facts.carriedCommitted) {
    if (facts.acceptedGaps.includes(key)) openGaps.push(`${key}:committed_kept`);
    else problems.push(`secrets_committed:${key}`);
  }
  const carriedSecrets: readonly string[] = CARRIED_SECRET_KEYS;
  for (const key of facts.shared) if (!carriedSecrets.includes(key)) problems.push(`secrets_shared:${key}`);
  for (const file of facts.missingBuilds) problems.push(`build_missing:${file}`);
  return { ok: problems.length === 0, problems, openGaps };
}

/** Gathers the facts on the host: the production env file, the live `.env`, `main`'s history, the builds. */
export function gatherPreflight(liveEnvPath: string, acceptedGaps: readonly string[], mainRef: string | undefined): PreflightFacts {
  const config = loadConfigFor("prod");
  const prodText = readFileSync(configFilePath("prod"), "utf8");
  const liveText = readFileSync(liveEnvPath, "utf8");
  const secrets = searchedSecrets(parseEnv(prodText));
  const git = gitIn(REPOSITORY_ROOT);
  const ref = existingRef(git, mainRef ? [mainRef] : ["main", "origin/main"]);
  const plan = planCarryOver(liveText, prodText);
  const live = parseEnv(liveText);
  const carriedSecrets = searchedSecrets(Object.fromEntries(CARRIED_SECRET_KEYS.filter((k) => plan.carried.includes(k)).map((k) => [k, live[k]])));
  const history = ref === null ? null : [...blobsOf(git, ref)];
  return {
    gaps: productionGaps(config),
    committed: history === null ? null : keysFoundIn(secrets, history),
    shared: keysSharedWith(secrets, live),
    carried: [...plan.carried, ...plan.already],
    carriedCommitted: history === null ? [] : keysFoundIn(carriedSecrets, history),
    acceptedGaps,
    missingBuilds: REQUIRED_BUILDS.filter((file) => !existsSync(join(REPOSITORY_ROOT, file))),
  };
}
