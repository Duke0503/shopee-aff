/**
 * A migrated ledger with two customers, a disabled one and the guest account, and the link job
 * wired as the composition root wires it, for the Epic 5 link tests (Stories 5.4, 5.5, 5.7).
 */
import { join } from "node:path";
import { fixedClock, instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";

import { linkEffectsFor } from "../../src/links/link-jobs";
import { queueLinkRequest, runLinkJob, type LinkChannel, type LinkCreator, type LinkJobRun } from "../../src/modules/linking/index";
import { openLedger, type Ledger } from "../../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../../src/platform/db/migrations";
import { createLogger, type Logger } from "../../src/platform/log/logger";
import type { BridgeLinkResult, BridgePort, LinkBridgeJob } from "../../src/platform/ports/bridge.port";
import { tempDir } from "./live-fixture";

export const LINK_START = "2026-11-01T03:00:00.000Z";
export const C1 = "1000000000000000001";
export const C2 = "1000000000000000002";
export const SHOPEE_PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
export const SILENT = createLogger({ level: "fatal" });

export function linkLedger(ledgers: Ledger[]): Ledger {
  const ledger = openLedger(join(tempDir("cashback-links-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), fixedClock(LINK_START));
  ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status) VALUES
    ('${C1}', 'DP00001', 'USER', 'ACTIVE'), ('${C2}', 'DP00002', 'USER', 'ACTIVE'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE')`);
  ledgers.push(ledger);
  return ledger;
}

/** A clock the test moves. */
export function movingClock(start = LINK_START): Clock & { advance(ms: number): void } {
  let now = toMs(parseInstant(start));
  return { now: () => instantFromMs(now), advance: (ms) => void (now += ms) };
}

export const queueLink = (ledger: Ledger, customer: string, url = SHOPEE_PRODUCT, clock: Clock = fixedClock(LINK_START), channel: LinkChannel = "zalo"): string =>
  ledger.tx((db) => queueLinkRequest(db, { customer, url, channel }, clock)).requestId;

/** A bridge that records what it was handed and answers with `answer`. */
export function answeringBridge(answer: (job: LinkBridgeJob) => BridgeLinkResult, mode: BridgePort["mode"] = "browser"): BridgePort & { jobs: LinkBridgeJob[] } {
  const jobs: LinkBridgeJob[] = [];
  return { mode, jobs, createLink: async (job) => (jobs.push(job), answer(job)) };
}

export interface LinkRunOptions {
  readonly clock?: Clock;
  readonly accessTrade?: LinkCreator | null;
  readonly logger?: Logger;
}

export const runLinks = (ledger: Ledger, bridge: BridgePort, options: LinkRunOptions = {}): Promise<LinkJobRun> => {
  const clock = options.clock ?? fixedClock(LINK_START);
  return runLinkJob(
    {
      ledger,
      clock,
      bridge,
      subIdPrefix: "",
      logger: options.logger ?? SILENT,
      effects: linkEffectsFor(clock),
      ...(options.accessTrade !== undefined ? { accessTrade: options.accessTrade } : {}),
    },
    new AbortController().signal,
  );
};

export interface LinkRow {
  status: string;
  affiliate_url: string | null;
  attempts: number;
  next_attempt_at: string | null;
  network: string | null;
  platform: string;
  product_key: string | null;
  page_errors: number;
}
export const linkRow = (ledger: Ledger, id: string): LinkRow =>
  ledger.sqlite.prepare("SELECT status, affiliate_url, attempts, next_attempt_at, network, platform, product_key, page_errors FROM link_requests WHERE request_id = ?").get(id) as LinkRow;

export const outboxRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT dedup_key, customer_id, message_key FROM outbox ORDER BY dedup_key").all() as { dedup_key: string; customer_id: string; message_key: string }[];
export const alertRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, severity, suppressed FROM alerts ORDER BY id").all() as { kind: string; severity: string; suppressed: number }[];
export const bridgeJobCount = (ledger: Ledger): number => (ledger.sqlite.prepare("SELECT count(*) AS n FROM bridge_jobs").get() as { n: number }).n;

/** Log lines written to memory, for checks on what a line carries. */
export function memoryLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: createLogger({ level: "info", destination: { write: (line: string) => void lines.push(line) } }), lines };
}
