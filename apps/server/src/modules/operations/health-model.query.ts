/**
 * The one health model (AD-27, FR-25, FR-30, Story 8.3): the browser bridge, the Zalo assistant,
 * the hourly reconciliation, the last backup and the link queue's depth, computed once here. The
 * Overview's health line (admin/overview-activity.query.ts) and the health check's owner alerts
 * (health.job.ts) both read this function, so the screen and the chat can never disagree. Each
 * entry that is down names the alert the health check raises for it; the kinds are the ones the
 * failing parts already raise themselves, so the cooldown merges both into one message.
 *
 * - bridge: down while the Shopee link queue is paused (login lost) or held (captcha, page error);
 *   otherwise not known, because the bridge does not report its liveness to the server.
 * - assistant: from the heartbeat store (Stories 6.1, 6.11).
 * - reconciliation: each network's hourly run on its own, the worst one wins (Story 4.17).
 * - backup: from the last daily run's status (Story 8.2).
 * - queue: up with its depth (every waiting link request); down once a request that is due (not
 *   in a retry wait) on a network whose queue is open has waited over 10 minutes. A paused or held
 *   Shopee queue is the bridge part's to report, not the queue's again.
 */
import type { OverviewHealth } from "@cashback/contracts";
import { parseInstant, toMs, type Clock, type Instant } from "@cashback/core";

import { LINK_QUEUE_ALERTS, oldestDueLinkRequest, shopeeQueueGate, shopeeQueueState, waitingLinkRequests } from "../linking/index";
import { hasRun, lastSucceededRun } from "../orders/index";
import type { BackupHealth } from "../../platform/backup/backup-status";
import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { AlertSeverity } from "../../platform/ports/alert.port";
import { ASSISTANT_DOWN_ALERT } from "./assistant-health.job";

/** The hourly reconciliation counts as down when its last success is older than this. */
export const RECONCILIATION_DOWN_AFTER_MS = 3 * 3_600_000;
/** The link queue counts as stuck when its oldest waiting request is older than this. */
export const QUEUE_STUCK_AFTER_MS = 10 * 60_000;

export const RECONCILIATION_DOWN_ALERT = { kind: "reconciliation_failed", severity: "high" } as const;
export const QUEUE_STUCK_ALERT = { kind: "link_queue_stuck", severity: "warning" } as const;

export interface HealthAlert {
  readonly kind: string;
  readonly severity: AlertSeverity;
}

export type HealthEntry = OverviewHealth & { readonly alert: HealthAlert | null };

type Liveness = { readonly state: "up" | "down" | "unknown"; readonly at: string | null };

/** What the model reads besides the ledger; each part missing is "not known yet". */
export interface HealthSources {
  /** The assistant's liveness at `now`, from the heartbeat store. */
  readonly assistant?: (now: Instant) => Liveness;
  /** The last backup's health at `now`, from its status file. */
  readonly backup?: (now: Instant) => BackupHealth;
}

const stale = (at: string | null, now: Instant, afterMs: number): boolean => at === null || toMs(now) - toMs(parseInstant(at)) > afterMs;

function bridgeHealth(db: LedgerDb, now: Instant): HealthEntry {
  const state = shopeeQueueState(db);
  if (state.pausedAt !== null) return { component: "bridge", state: "down", at: state.pausedAt, alert: LINK_QUEUE_ALERTS[state.pausedReason ?? "login_redirect"] };
  if (state.heldUntil !== null && !stale(state.heldUntil, now, 0)) return { component: "bridge", state: "down", at: null, alert: LINK_QUEUE_ALERTS[state.heldReason ?? "captcha"] };
  return { component: "bridge", state: "unknown", at: null, alert: null };
}

/**
 * A network whose last success is over 3 hours old, or that never succeeded while it or another
 * network recorded a run, is down. Before any hourly run nothing reports yet. `at` is the oldest
 * of the last successes.
 */
function reconciliationHealth(db: LedgerDb, now: Instant): HealthEntry {
  const networks = ["shopee", "accesstrade"] as const;
  const last = networks.map((n) => lastSucceededRun(db, n, "HOURLY"));
  const seen = last.filter((at) => at !== null).sort();
  const ran = networks.filter((n) => hasRun(db, n, "HOURLY"));
  if (seen.length === 0 && ran.length === 0) return { component: "reconciliation", state: "unknown", at: null, alert: null };
  const watched = networks.map((n, i) => ({ ran: ran.includes(n) || last[i] !== null, at: last[i] ?? null })).filter((w) => w.ran || seen.length > 0);
  const down = watched.some((w) => stale(w.at, now, RECONCILIATION_DOWN_AFTER_MS));
  return { component: "reconciliation", state: down ? "down" : "up", at: seen[0] ?? null, alert: down ? RECONCILIATION_DOWN_ALERT : null };
}

function queueHealth(db: LedgerDb, now: Instant): HealthEntry {
  const waiting = waitingLinkRequests(db);
  const open = shopeeQueueGate(db, now) === "open" ? (["shopee", "accesstrade"] as const) : (["accesstrade"] as const);
  const dueSince = oldestDueLinkRequest(db, now, open);
  const stuck = dueSince !== null && stale(dueSince, now, QUEUE_STUCK_AFTER_MS);
  return { component: "queue", state: stuck ? "down" : "up", at: stuck ? dueSince : waiting.oldestAt, count: waiting.count, alert: stuck ? QUEUE_STUCK_ALERT : null };
}

export function healthModel(db: LedgerDb, clock: Clock, sources: HealthSources = {}): HealthEntry[] {
  const now = clock.now();
  const assistant = sources.assistant?.(now) ?? { state: "unknown", at: null };
  const backup = sources.backup?.(now) ?? { state: "unknown", at: null, alert: null };
  return [
    bridgeHealth(db, now),
    { component: "assistant", state: assistant.state, at: assistant.at, alert: assistant.state === "down" ? ASSISTANT_DOWN_ALERT : null },
    reconciliationHealth(db, now),
    { component: "backup", state: backup.state, at: backup.at, alert: backup.state === "down" ? backup.alert : null },
    queueHealth(db, now),
  ];
}

/** The model read in one snapshot of the ledger. */
export function readHealthModel(ledger: Ledger, clock: Clock, sources: HealthSources = {}): HealthEntry[] {
  return ledger.sqlite.transaction(() => healthModel(ledger.db, clock, sources)).deferred();
}

/** The model as the Overview shows it: the same entries without the alert. */
export const withoutAlerts = (entries: readonly HealthEntry[]): OverviewHealth[] => entries.map(({ alert: _alert, ...entry }) => entry);
