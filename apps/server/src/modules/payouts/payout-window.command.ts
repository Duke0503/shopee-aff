/**
 * The 72-hour no-payout window after the cutover (AD-24, D40, D46; Story 8.8). While it is open,
 * payout confirm is refused (`confirm_paused`), so no transfer is recorded in the new ledger while
 * a rollback to the live system can still happen and the live system could pay the same order.
 * The cutover import opens it with its end; only the owner closes it, by command, and not before
 * that end. Closing it is final: there is no command that reopens it after go-live. Each change is
 * audited with its actor.
 */
import { instantFromMs, parseInstant, toMs, type Instant } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { payoutSettings } from "./schema";

/** The window's length: rollback is offered only inside it. */
export const CUTOVER_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface PayoutWindow {
  /** True while payout confirm is refused. */
  readonly open: boolean;
  readonly endsAt: Instant | null;
  readonly changedAt: Instant | null;
  readonly changedBy: string | null;
}

export type PayoutWindowErrorCode = "window_not_over" | "window_already_closed";

export class PayoutWindowError extends Error {
  constructor(readonly code: PayoutWindowErrorCode) {
    super(`payout window: ${code}`);
    this.name = "PayoutWindowError";
  }
}

export function payoutWindow(db: LedgerDb): PayoutWindow {
  const row = db.select().from(payoutSettings).where(eq(payoutSettings.id, 1)).get();
  const endsAt = row?.windowEndsAt ?? null;
  return {
    open: endsAt !== null,
    endsAt: endsAt === null ? null : parseInstant(endsAt),
    changedAt: row?.changedAt ? parseInstant(row.changedAt) : null,
    changedBy: row?.changedBy ?? null,
  };
}

/** What the Payouts screen shows: whether payouts are paused and until when. */
export const windowState = (db: LedgerDb): { open: boolean; endsAt: Instant | null } => {
  const w = payoutWindow(db);
  return { open: w.open, endsAt: w.endsAt };
};

/** The `confirmPaused` hook of payout confirm (Story 4.8). */
export const isConfirmPaused = (db: LedgerDb): boolean => payoutWindow(db).open;

function write(db: LedgerDb, endsAt: Instant | null, at: Instant, by: CommandAudit): void {
  const changedBy = `${by.actor.kind}:${by.actor.id}`;
  db.insert(payoutSettings)
    .values({ id: 1, windowEndsAt: endsAt, changedAt: at, changedBy })
    .onConflictDoUpdate({ target: payoutSettings.id, set: { windowEndsAt: endsAt, changedAt: at, changedBy } })
    .run();
}

/** Opens the window for 72 hours from `at`; call inside `tx` (the cutover import does). */
export function openPayoutWindow(db: LedgerDb, at: Instant, by: CommandAudit): PayoutWindow {
  const endsAt = instantFromMs(toMs(at) + CUTOVER_WINDOW_MS);
  write(db, endsAt, at, by);
  by.audit.record({ actor: by.actor, event: "payouts.window.opened", entityId: "payouts.cutover_window", payload: { endsAt } });
  return payoutWindow(db);
}

/** Closes the window once its end has passed; call inside `tx`. Refused earlier, and when already closed. */
export function closePayoutWindow(db: LedgerDb, at: Instant, by: CommandAudit): PayoutWindow {
  const current = payoutWindow(db);
  if (!current.open || current.endsAt === null) throw new PayoutWindowError("window_already_closed");
  if (toMs(at) < toMs(current.endsAt)) throw new PayoutWindowError("window_not_over");
  write(db, null, at, by);
  by.audit.record({ actor: by.actor, event: "payouts.window.closed", entityId: "payouts.cutover_window", payload: { endedAt: current.endsAt } });
  return payoutWindow(db);
}
