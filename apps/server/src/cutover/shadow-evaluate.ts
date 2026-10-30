/**
 * The new reconciliation over the imported ledger, in memory (D44, Story 2.9, AD-7, AD-8): each
 * report row is attributed (attribution.ts) and applied with `transition` (report signal and
 * split included) to the order as the cutover imports it, in the order the report gives the
 * rows. Nothing is written; the effects only tell what would change.
 *
 * - An imported order the report holds: its rows go through `transition`; PAID never changes
 *   state (D4), a cancel or a drop after payout is only a would-be clawback.
 * - An awaiting or approved unpaid order the report does not hold would be FROZEN with a review
 *   case: older than the report window (the report can no longer verify it), or missing inside it.
 * - A report row of an order the live ledger lacks is recorded as reconciliation would record it.
 *
 * Every order is valued the same way on both sides: payable is the stored cashback of an
 * APPROVED unpaid order plus the bonus riding on it (D27, D35); waiting is an AWAITING_APPROVAL
 * order's estimate through the FR-13 split with the live 10% withholding. The guest account
 * (HOUSE) gets 0 on both sides (D5). An approval the run makes reads the withheld setting exactly
 * as the ledger apply does (orders/domain/settlement.ts): the run's month, with any staff marks.
 */
import { canTransition, type Instant, type OrderStatus } from "@cashback/core";
import { differenceDong, splitCommission, sumDong, type AffiliateNetwork } from "@cashback/money";

import type { SourcedRow } from "../modules/linking/index";
import { applyResult, attribute, periodIsWithheld, rowCommission, settlementPeriodOf, splitWithheld, transition, type AttributionDirectory, type ImportedOrder, type TransitionOrder } from "../modules/orders/index";
import type { LiveData } from "./import-steps";
import { classify, type Classified, type ShadowReason } from "./shadow-reasons";

export interface ShadowSide {
  status: OrderStatus | null;
  cashback: number | null;
  payable: number;
  waiting: number;
}

export interface ShadowOrder {
  orderId: string;
  network: AffiliateNetwork | null;
  customerId: string | null;
  guest: boolean;
  live: ShadowSide;
  shadow: ShadowSide & { clawback: number };
  steps: string[];
  reviewCases: string[];
  payableDifference: number;
  waitingDifference: number;
  reason: ShadowReason;
  detail: string | null;
  /** Report rows applied to the order. */
  rows: number;
  changed: boolean;
}

export interface ShadowInputs {
  live: LiveData;
  /** The report rows per network that has a source; a network missing here is not evaluated. */
  rows: ReadonlyMap<AffiliateNetwork, readonly SourcedRow[]>;
  /** The report window per network. */
  window: ReadonlyMap<AffiliateNetwork, ReportWindow>;
  /** Approved unpaid live orders whose live customer id is no customer: live payouts never list them. */
  liveOrphans: ReadonlySet<string>;
  /** When the run approves what it approves: the approval month's period decides the withheld setting (D54). */
  approvedAt: Instant;
  /** Staff marks per `<network>|<YYYY-MM>`; a period without one counts as withheld. The cutover imports none. */
  periodMarks?: ReadonlyMap<string, boolean>;
}

export interface ReportWindow {
  /** The first instant the report covers; null when unknown (every unseen order is older). */
  from: Instant | null;
  /** The last instant the report covers; null when unknown (no unseen order is newer). */
  to: Instant | null;
}

interface Applied {
  order: TransitionOrder | null;
  customerId: string | null;
  estimate: number | null;
  steps: string[];
  reviewCases: string[];
  clawback: number;
  /** The withheld setting stored with the order's approval; null before one or for an imported approval. */
  withheld: boolean | null;
}

interface Bonus {
  open: number;
  paid: number;
}

/** The waiting estimate uses the live 10% withholding, as the import's cashback check does. */
const WITHHELD = true;

export function estimateCashback(estimate: number | null, network: AffiliateNetwork | null, guest: boolean): number {
  if (estimate === null || network === null || guest || !Number.isSafeInteger(estimate) || estimate < 0) return 0;
  return splitCommission({ approvedCommission: estimate, network, withheld: WITHHELD }).cashback;
}

/** Bonus riding on each order: only CONFIRMED is payable (bonus_owed, D27; HELD never is); PAID counts for a clawback (D35). */
function bonusesOf(live: LiveData): Map<string, Bonus> {
  const out = new Map<string, Bonus>();
  for (const a of live.campaigns.awards) {
    const entry = out.get(a.orderId) ?? { open: 0, paid: 0 };
    if (a.status === "PAID") entry.paid = sumDong([entry.paid, a.amount], "bonus");
    else if (a.status === "CONFIRMED") entry.open = sumDong([entry.open, a.amount], "bonus");
    out.set(a.orderId, entry);
  }
  return out;
}

interface SideFacts {
  network: AffiliateNetwork | null;
  guest: boolean;
  bonus: number;
}

function sideOf(status: OrderStatus | null, paidAt: string | null, cashback: number | null, estimate: number | null, facts: SideFacts): ShadowSide {
  const payable = status === "APPROVED" && paidAt === null && !facts.guest ? sumDong([cashback ?? 0, facts.bonus], "payable") : 0;
  const waiting = status === "AWAITING_APPROVAL" ? estimateCashback(estimate, facts.network, facts.guest) : 0;
  return { status, cashback, payable, waiting };
}

/** The withheld setting of a new approval in this run, read as the ledger apply reads it (orders/domain/settlement.ts). */
function periodNow(inputs: ShadowInputs, network: AffiliateNetwork): boolean {
  return periodIsWithheld(network, inputs.periodMarks?.get(`${network}|${settlementPeriodOf(inputs.approvedAt)}`) ?? null);
}

/** One row through attribution (for an order not recorded yet) and `transition`; effects only noted. */
function applyRow(applied: Applied, row: SourcedRow, network: AffiliateNetwork, ctx: { paidBonus: number; ev: Evaluation }): void {
  const attribution = applied.order === null ? attribute(row, ctx.ev.directory, true) : undefined;
  const holder = applied.order === null ? null : { status: applied.order.status, cashbackWithheld: applied.withheld };
  const withheld = splitWithheld(holder, () => periodNow(ctx.ev.inputs, network));
  const result = transition(applied.order, { kind: "report", row }, { network, withheld, paidBonus: ctx.paidBonus, alreadyClawedBack: applied.clawback, attribution });
  const step = applyResult(applied.order, result);
  if (step.approval !== null) applied.withheld = step.approval.withheld;
  if (step.createdFor !== null) applied.customerId = step.createdFor;
  applied.clawback = sumDong([applied.clawback, step.clawback], "clawback");
  applied.reviewCases.push(...step.reviewCases);
  applied.steps.push(...result.steps.map(([from, to]) => `${from ?? "NEW"}->${to}`));
  if (step.applied) {
    applied.order = step.order;
    applied.estimate = rowCommission(row) ?? applied.estimate;
  }
}

export function directoryOf(live: LiveData): AttributionDirectory {
  const { context } = live;
  const byCode = new Map(live.identity.customers.flatMap((c) => (c.customerCode === null ? [] : [[c.customerCode.toUpperCase(), c.customerId] as const])));
  const owners = new Map(live.links.links.linkRequests.map((r) => [r.requestId, r.customerId]));
  const survivor = (key: string): string | null => {
    if (context.customerIds.has(key)) return key;
    const target = byCode.get(key.toUpperCase()) ?? context.aliases.get(key) ?? context.aliases.get(key.toUpperCase());
    return target !== undefined && context.customerIds.has(target) ? target : null;
  };
  return {
    resolveCustomer: (key) => {
      const id = survivor(key);
      return id === null ? null : { customerId: id, guest: context.houseIds.has(id) };
    },
    requestOwner: (requestId) => owners.get(requestId) ?? null,
  };
}

interface Evaluation {
  inputs: ShadowInputs;
  directory: AttributionDirectory;
  bonuses: Map<string, Bonus>;
}

function finish(base: Omit<ShadowOrder, "payableDifference" | "waitingDifference" | "changed" | "reason" | "detail">, classified: (d: { payable: number; waiting: number }) => Classified): ShadowOrder {
  const payableDifference = differenceDong(base.shadow.payable, base.live.payable);
  const waitingDifference = differenceDong(base.shadow.waiting, base.live.waiting);
  const { reason, detail } = classified({ payable: payableDifference, waiting: waitingDifference });
  const changed = !NOT_JUDGED.includes(reason) || base.live.status !== base.shadow.status || payableDifference !== 0 || waitingDifference !== 0 || base.shadow.clawback > 0 || base.reviewCases.length > 0;
  return { ...base, payableDifference, waitingDifference, reason, detail, changed };
}

/** Reasons that say the order was not judged, not that it differs. */
export const NOT_JUDGED: readonly ShadowReason[] = ["unchanged", "no_report_source", "unknown_network", "newer_than_report_window"];

const unchanged = (reason: ShadowReason) => (): Classified => ({ reason, detail: null });

/**
 * An imported order the report does not hold: an unpaid awaiting or approved one would be FROZEN,
 * unless it was recorded after the report ends, when the report says nothing about it yet.
 */
function unseen(o: ImportedOrder, window: ReportWindow): Pick<Applied, "steps" | "reviewCases"> & { status: OrderStatus; reason: ShadowReason } {
  const open = (o.status === "AWAITING_APPROVAL" || o.status === "APPROVED") && o.paidAt === null;
  if (!open || !canTransition("order", o.status, "FROZEN")) return { status: o.status, steps: [], reviewCases: [], reason: "unchanged" };
  if (window.to !== null && o.recordedAt !== null && o.recordedAt > window.to) return { status: o.status, steps: [], reviewCases: [], reason: "newer_than_report_window" };
  const older = window.from === null || o.recordedAt === null || o.recordedAt < window.from;
  return { status: "FROZEN", steps: [`${o.status}->FROZEN`], reviewCases: ["not_in_report"], reason: older ? "older_than_report_window" : "missing_from_report" };
}

function evaluateImported(o: ImportedOrder, rows: readonly SourcedRow[] | undefined, ev: Evaluation): ShadowOrder {
  const guest = o.customerId !== null && ev.inputs.live.context.houseIds.has(o.customerId);
  const bonus = ev.bonuses.get(o.orderId) ?? { open: 0, paid: 0 };
  const facts: SideFacts = { network: o.network, guest, bonus: bonus.open };
  const orphan = ev.inputs.liveOrphans.has(o.orderId);
  // Live payouts list only orders of an existing customer: an orphan is owed to nobody live.
  const live = { ...sideOf(o.status, o.paidAt, o.cashback, o.estimatedCommission, facts), ...(orphan ? { payable: 0 } : {}) };
  const orphaned = (c: Classified): Classified => (orphan && c.reason === "unchanged" ? { reason: "live_orphan_owed", detail: null } : c);
  const base = { orderId: o.orderId, network: o.network, customerId: o.customerId, guest, live, rows: rows?.length ?? 0 };
  const sourceRows = o.network === null ? undefined : ev.inputs.rows.get(o.network);
  if (o.network === null || sourceRows === undefined) {
    return finish({ ...base, shadow: { ...live, clawback: 0 }, steps: [], reviewCases: [] }, unchanged(o.network === null ? "unknown_network" : "no_report_source"));
  }
  if (rows === undefined || rows.length === 0) {
    const u = unseen(o, ev.inputs.window.get(o.network) ?? { from: null, to: null });
    return finish({ ...base, shadow: { ...sideOf(u.status, o.paidAt, o.cashback, o.estimatedCommission, facts), clawback: 0 }, steps: u.steps, reviewCases: u.reviewCases }, () => orphaned({ reason: u.reason, detail: null }));
  }
  const start: TransitionOrder = { status: o.status, paidAt: o.paidAt, approvedCommission: o.approvedCommission, cashback: o.cashback, guest };
  const applied: Applied = { order: start, customerId: o.customerId, estimate: o.estimatedCommission, steps: [], reviewCases: [], clawback: 0, withheld: null };
  for (const row of rows) applyRow(applied, row, o.network, { paidBonus: guest ? 0 : bonus.paid, ev });
  const order = applied.order ?? start;
  const shadow = { ...sideOf(order.status, o.paidAt, order.cashback, applied.estimate, facts), clawback: applied.clawback };
  const network = o.network;
  return finish({ ...base, shadow, steps: applied.steps, reviewCases: applied.reviewCases }, (d) =>
    orphaned(classify({ network, liveStatus: o.status, shadowStatus: order.status, last: rows.at(-1) as SourcedRow, clawback: applied.clawback, reviewCases: applied.reviewCases, payableDifference: d.payable, waitingDifference: d.waiting })),
  );
}

function evaluateNew(orderId: string, network: AffiliateNetwork, rows: readonly SourcedRow[], ev: Evaluation): ShadowOrder {
  const applied: Applied = { order: null, customerId: null, estimate: null, steps: [], reviewCases: [], clawback: 0, withheld: null };
  for (const row of rows) applyRow(applied, row, network, { paidBonus: 0, ev });
  const guest = applied.order?.guest ?? false;
  const live: ShadowSide = { status: null, cashback: null, payable: 0, waiting: 0 };
  const order = applied.order;
  const shadow = { ...sideOf(order?.status ?? null, null, order?.cashback ?? null, applied.estimate, { network, guest, bonus: 0 }), clawback: 0 };
  const base = { orderId, network, customerId: applied.customerId, guest, live, shadow, steps: applied.steps, reviewCases: applied.reviewCases, rows: rows.length };
  return finish(base, unchanged(order === null ? "unattributed_report_row" : "not_in_live_ledger"));
}

const keyOf = (network: AffiliateNetwork | null, orderId: string): string => `${network ?? ""}|${orderId}`;

/** Every imported order and every report order the ledger lacks, sorted by order id then network. */
export function evaluateShadow(inputs: ShadowInputs): ShadowOrder[] {
  const ev: Evaluation = { inputs, directory: directoryOf(inputs.live), bonuses: bonusesOf(inputs.live) };
  const byOrder = new Map<string, { network: AffiliateNetwork; orderId: string; rows: SourcedRow[] }>();
  for (const [network, rows] of inputs.rows) {
    for (const [i, row] of rows.entries()) {
      // A row without an order id is never grouped with another (D31).
      const key = row.orderId === "" ? `${network}|#${i}` : keyOf(network, row.orderId);
      const entry = byOrder.get(key) ?? { network, orderId: row.orderId, rows: [] };
      entry.rows.push(row);
      byOrder.set(key, entry);
    }
  }
  const out = inputs.live.orders.map((o) => evaluateImported(o, byOrder.get(keyOf(o.network, o.orderId))?.rows, ev));
  const imported = new Set(inputs.live.orders.map((o) => keyOf(o.network, o.orderId)));
  for (const [key, entry] of byOrder) if (!imported.has(key)) out.push(evaluateNew(entry.orderId, entry.network, entry.rows, ev));
  return out.sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : (a.network ?? "") < (b.network ?? "") ? -1 : 1));
}
