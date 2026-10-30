/**
 * Reading campaigns and awards from the live copy (Story 2.4). A campaign window is converted by
 * the Vietnam-time rule of Story 2.1 (staff typed it, campaigns.py:55-58), start inclusive and
 * end exclusive (D22). Every award keeps its live id, order, amount and state (campaigns.py:23-26
 * held, confirmed, paid, void); an award that cannot be imported (its order or customer is gone,
 * a guest holds it, its state is unknown) is listed, never guessed. An award whose state
 * disagrees with its order is imported as it is and listed for the owner. A HELD award is never
 * payable, and one on a FROZEN order is suspended (D55): both are decided from state, not here.
 * A campaign staff stopped, or whose window cannot be read or ends before it starts, gives no new
 * slot and is listed with the reason. Two live awards holding one slot (campaign and order, not
 * void) cannot both be imported: the earliest is kept and the others listed, before anything is
 * written, so the unique slot index never aborts the import.
 *
 * Live notifications.py:703-755 told a customer once on winning a slot (`notified_status` set
 * to the award's status) and once on losing it (`void`, only after the win was told). A told
 * event is seeded as sent (D46) only when it agrees with the imported state; a loss told on an
 * award that holds its slot again is not seeded, and the win it now owes is listed with every
 * other event still owed.
 */
import type { CampaignAwardStatus, OrderStatus } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedAward, ImportedCampaign } from "../modules/campaigns/index";
import { dedupKey, type SeededNotification } from "../modules/messaging/index";
import { ownerOf, type CutoverContext } from "./cutover-context";
import type { CampaignStopReason, ImportReport } from "./import-report";
import { convertLiveTime } from "./live-time";
import { wholeDong } from "./live-values";

interface LiveCampaign {
  campaign_id: string;
  name: string;
  starts_at: unknown;
  ends_at: unknown;
  slots: unknown;
  bonus_vnd: unknown;
  min_order_value: unknown;
  platforms: string | null;
  excluded_customers: string | null;
  per_customer: unknown;
  status: string | null;
  created_at: unknown;
}

interface LiveAward {
  id: number;
  campaign_id: string;
  customer_id: string;
  order_id: string;
  amount: unknown;
  status: string;
  created_at: unknown;
  confirmed_at: unknown;
  paid_at: unknown;
  voided_at: unknown;
  notified_status: string | null;
}

const AWARD_STATUS: Readonly<Record<string, CampaignAwardStatus>> = { held: "HELD", confirmed: "CONFIRMED", paid: "PAID", void: "VOID" };

export interface LiveCampaigns {
  campaigns: ImportedCampaign[];
  awards: ImportedAward[];
  seeds: SeededNotification[];
  listed: string[];
  stopped: { campaignId: string; reason: CampaignStopReason }[];
}

export interface ImportedOrderFacts {
  customerId: string | null;
  status: OrderStatus;
}

function count(value: unknown, row: LiveCampaign, column: string, report: ImportReport): number {
  const n = wholeDong(value ?? 0, { allowZero: true });
  if (n !== null) return n;
  report.notes.push({ kind: "campaign_amount_not_whole_dong", table: "campaigns", key: row.campaign_id, detail: column });
  return 0;
}

function campaignOf(row: LiveCampaign, report: ImportReport, stopped: LiveCampaigns["stopped"]): ImportedCampaign {
  const time = (column: string, value: unknown) => convertLiveTime(value, { table: "campaigns", column, key: row.campaign_id }, report).instant;
  const startsAt = time("starts_at", row.starts_at);
  let endsAt = time("ends_at", row.ends_at);
  let reason: CampaignStopReason | null = null;
  if ((row.status ?? "active") !== "active") {
    report.notes.push({ kind: "campaign_stopped", table: "campaigns", key: row.campaign_id, detail: row.status ?? "" });
    reason = "stopped_live";
  }
  if (startsAt === null || endsAt === null) {
    // The value itself is in the report's time problems; without a window no slot is given.
    reason ??= "window_unreadable";
  } else if (startsAt >= endsAt) {
    report.notes.push({ kind: "campaign_window_invalid", table: "campaigns", key: row.campaign_id });
    endsAt = null;
    reason ??= "window_invalid";
  }
  if (reason !== null) stopped.push({ campaignId: row.campaign_id, reason });
  const acceptsAwards = reason === null;
  return {
    campaignId: row.campaign_id,
    name: row.name,
    startsAt,
    endsAt,
    slots: count(row.slots, row, "slots", report),
    bonus: count(row.bonus_vnd, row, "bonus_vnd", report),
    minOrderValue: count(row.min_order_value, row, "min_order_value", report),
    platforms: row.platforms ?? "",
    excludedCustomers: row.excluded_customers ?? "",
    perCustomer: count(row.per_customer, row, "per_customer", report),
    acceptsAwards,
    createdAt: time("created_at", row.created_at),
  };
}

interface AwardContext {
  context: CutoverContext;
  campaignIds: ReadonlySet<string>;
  orders: ReadonlyMap<string, ImportedOrderFacts>;
  report: ImportReport;
}

type NoteKind = ImportReport["notes"][number]["kind"];

/** The award as imported, or null with a note when it cannot be. */
function awardOf(row: LiveAward, at: AwardContext): ImportedAward | null {
  const note = (kind: NoteKind, detail?: string): null => {
    at.report.notes.push({ kind, table: "campaign_awards", key: String(row.id), ...(detail === undefined ? {} : { detail }) });
    return null;
  };
  if (!at.campaignIds.has(row.campaign_id)) return note("award_campaign_missing");
  const order = at.orders.get(row.order_id);
  if (!order) return note("award_order_missing");
  const owner = ownerOf(at.context, row.customer_id);
  if (owner === null) return note("award_customer_missing");
  if (at.context.houseIds.has(owner.customerId)) return note("award_to_guest");
  const status = Object.hasOwn(AWARD_STATUS, row.status) ? AWARD_STATUS[row.status] : undefined;
  if (status === undefined) return note("unknown_award_status", row.status);
  const amount = wholeDong(row.amount, { allowZero: true });
  if (amount === null) return note("award_amount_not_whole_dong");
  if (owner.via === "alias") note("award_customer_via_alias");
  if (order.customerId !== owner.customerId) note("award_owner_differs");
  if (status === "PAID" && order.status !== "PAID") note("award_paid_order_unpaid", order.status);
  if (status === "CONFIRMED" && order.status === "PAID") note("award_confirmed_order_paid");
  const time = (column: string, value: unknown) => convertLiveTime(value, { table: "campaign_awards", column, key: String(row.id) }, at.report).instant;
  return {
    awardId: row.id,
    campaignId: row.campaign_id,
    customerId: owner.customerId,
    orderId: row.order_id,
    amount,
    status,
    createdAt: time("created_at", row.created_at),
    confirmedAt: time("confirmed_at", row.confirmed_at),
    paidAt: time("paid_at", row.paid_at),
    voidedAt: time("voided_at", row.voided_at),
  };
}

const HELD_EVENT = { event: "held", messageKey: "campaign_slot_held" };
const LOST_EVENT = { event: "void", messageKey: "campaign_slot_lost" };

/** The told events of one award (seeded) and the one still owed (listed). */
function awardNotifications(row: LiveAward, award: ImportedAward, out: LiveCampaigns, report: ImportReport): void {
  const key = (event: string) => dedupKey("campaign_award", String(award.awardId), event);
  const seed = (e: typeof HELD_EVENT) => out.seeds.push({ dedupKey: key(e.event), customerId: award.customerId, messageKey: e.messageKey, sentAt: null });
  const owe = (e: typeof HELD_EVENT) => out.listed.push(key(e.event));
  const told = row.notified_status;
  const holds = award.status !== "VOID";
  if (told === null || told === "") {
    if (holds) owe(HELD_EVENT);
    return;
  }
  if (!Object.hasOwn(AWARD_STATUS, told)) {
    report.notes.push({ kind: "unknown_award_notified_status", table: "campaign_awards", key: String(row.id), detail: told });
    return;
  }
  if (told !== "void") {
    seed(HELD_EVENT);
    if (!holds) owe(LOST_EVENT);
  } else if (!holds) {
    seed(HELD_EVENT);
    seed(LOST_EVENT);
  } else {
    owe(HELD_EVENT);
  }
}

/** Keeps the earliest of live awards holding one slot (campaign and order, not void); lists the rest. */
function withoutDuplicateSlots(rows: readonly LiveAward[], report: ImportReport): LiveAward[] {
  const holders = new Map<string, number>();
  return rows.filter((row) => {
    if (row.status === "void") return true;
    const slot = `${row.campaign_id}|${row.order_id}`;
    const first = holders.get(slot);
    if (first === undefined) {
      holders.set(slot, row.id);
      return true;
    }
    report.notes.push({ kind: "duplicate_live_award", table: "campaign_awards", key: String(row.id), detail: String(first) });
    return false;
  });
}

export function readLiveCampaigns(source: BetterSqlite3.Database, context: CutoverContext, orders: ReadonlyMap<string, ImportedOrderFacts>, report: ImportReport): LiveCampaigns {
  const liveCampaigns = source.prepare("SELECT * FROM campaigns ORDER BY campaign_id").all() as LiveCampaign[];
  const stopped: LiveCampaigns["stopped"] = [];
  const out: LiveCampaigns = { campaigns: liveCampaigns.map((row) => campaignOf(row, report, stopped)), awards: [], seeds: [], listed: [], stopped };
  const at: AwardContext = { context, campaignIds: new Set(out.campaigns.map((c) => c.campaignId)), orders, report };
  const rows = withoutDuplicateSlots(source.prepare("SELECT * FROM campaign_awards ORDER BY id").all() as LiveAward[], report);
  for (const row of rows) {
    const award = awardOf(row, at);
    if (award === null) continue;
    out.awards.push(award);
    awardNotifications(row, award, out, report);
  }
  return out;
}
