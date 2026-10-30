/**
 * Reading payouts from the live copy (Story 2.4). Each live `payment_transfers` row becomes one
 * RECORDED payout with its live id, amount, reference and bill token unchanged (D49: the receipt
 * shows facts only, so the proof image is kept as a staff-only reference). The transfer's
 * `order_ids` list (dashboard.py:2565, 2878) names the orders it covered: each one that the
 * import holds as PAID for the same customer is linked with its stored cashback, and each bonus
 * PAID on it with its amount. The earliest transfer naming an order gets it; any other naming is
 * listed. A transfer for a customer who is gone, or for the guest account (D5), cannot be a
 * payout and is listed; paid parity then fails for it, as it should.
 *
 * The live confirm screen could mark orders paid without naming them on the transfer
 * (dashboard.py:2930-2938): those orders are listed as paid without a payout for the owner to
 * sign off, never given an invented payout. Live `notified_at` marks a transfer the customer was
 * told about (dashboard.py:2878-2881): its key is seeded as sent (D46), any other is listed.
 *
 * A bill token is kept as it is when `findReceipt` opens it and no earlier transfer holds it; a
 * repeated one stays on the earliest transfer and a malformed one is kept but not counted, both
 * listed. The receipt's last four digits are those of the account the transfer went to when the
 * live row records one; live transfers record none, so they fall back to the customer's account
 * at import and the report names each payout that did.
 */
import { sumDong } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedAward } from "../modules/campaigns/index";
import { dedupKey, type SeededNotification } from "../modules/messaging/index";
import type { ImportedOrder } from "../modules/orders/index";
import { lastFour } from "../modules/identity/index";
import { isReceiptToken, type ImportedPayout, type ImportedPayoutItem } from "../modules/payouts/index";
import { ownerOf, type CutoverContext } from "./cutover-context";
import type { ImportReport, PayoutsSection } from "./import-report";
import { convertLiveTime } from "./live-time";
import { blank, wholeDong } from "./live-values";

interface LiveTransfer {
  id: number;
  customer_id: string;
  amount: unknown;
  transfer_code: string | null;
  note: string | null;
  proof_image: string | null;
  order_ids: string | null;
  notified_at: unknown;
  created_at: unknown;
  created_by: string | null;
  bill_token: string | null;
  /** Not in the live schema today; read when a copy has it, so the receipt shows the account paid. */
  bank_account?: string | null;
}

export interface LivePayouts {
  payouts: ImportedPayout[];
  items: ImportedPayoutItem[];
  seeds: SeededNotification[];
  listed: string[];
  section: PayoutsSection;
}

export interface PayoutInputs {
  context: CutoverContext;
  orders: readonly Pick<ImportedOrder, "orderId" | "customerId" | "status" | "cashback">[];
  awards: readonly Pick<ImportedAward, "awardId" | "orderId" | "customerId" | "status" | "amount">[];
  /** Each customer's bank account number at import, the receipt's fallback. */
  bankAccounts: ReadonlyMap<string, string>;
}

type NoteKind = ImportReport["notes"][number]["kind"];

const text = (value: string | null | undefined): string | null => blank(value, { trim: true });

/** The last four digits, or null when the number normalises to nothing. */
const fourOf = (accountNumber: string | null | undefined): string | null => {
  const four = accountNumber === null || accountNumber === undefined ? "" : lastFour(accountNumber);
  return four === "" ? null : four;
};

interface Linker {
  /** Order ids already linked to a payout. */
  readonly linked: Set<string>;
  /** The items of one transfer: its orders in the order it named them, each followed by its bonuses. */
  itemsOf(row: LiveTransfer, customerId: string): ImportedPayoutItem[];
}

function linkerOf(inputs: PayoutInputs, report: ImportReport): Linker {
  const orders = new Map(inputs.orders.map((o) => [o.orderId, o]));
  const paidAwards = new Map<string, PayoutInputs["awards"][number][]>();
  for (const a of inputs.awards) {
    if (a.status !== "PAID") continue;
    const list = paidAwards.get(a.orderId);
    if (list) list.push(a);
    else paidAwards.set(a.orderId, [a]);
  }
  const linked = new Set<string>();
  const note = (kind: NoteKind, payoutId: number, orderId: string) => report.notes.push({ kind, table: "payment_transfers", key: String(payoutId), detail: orderId });
  const itemsOf = (row: LiveTransfer, customerId: string): ImportedPayoutItem[] => {
    const ids = [...new Set((row.order_ids ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""))];
    const items: ImportedPayoutItem[] = [];
    for (const orderId of ids) {
      const order = orders.get(orderId);
      if (!order) note("payout_order_missing", row.id, orderId);
      else if (order.customerId !== customerId) note("payout_order_other_customer", row.id, orderId);
      else if (order.status !== "PAID") note("payout_order_not_paid", row.id, orderId);
      else if (linked.has(orderId)) note("payout_order_twice", row.id, orderId);
      else {
        linked.add(orderId);
        items.push({ payoutId: row.id, kind: "ORDER", orderId, awardId: null, amount: order.cashback ?? 0 });
        for (const award of paidAwards.get(orderId) ?? []) {
          if (award.customerId === customerId) items.push({ payoutId: row.id, kind: "AWARD", orderId, awardId: award.awardId, amount: award.amount });
        }
      }
    }
    return items;
  };
  return { linked, itemsOf };
}

interface Tokens {
  /** Tokens already given to a payout. */
  readonly taken: Set<string>;
  /** Payout ids whose token findReceipt would not open. */
  readonly malformed: Set<number>;
}

interface PayoutContext {
  readonly tokens: Tokens;
  /** Payout ids whose receipt digits come from the customer's account at import. */
  readonly bankFromCustomer: number[];
  readonly report: ImportReport;
}

/** The token to store: null when absent or held by an earlier transfer, each listed. */
function tokenOf(row: LiveTransfer, tokens: Tokens, report: ImportReport): string | null {
  const note = (kind: NoteKind) => report.notes.push({ kind, table: "payment_transfers", key: String(row.id) });
  const token = text(row.bill_token);
  if (token === null) {
    note("bill_token_missing");
    return null;
  }
  if (tokens.taken.has(token)) {
    note("bill_token_duplicate");
    return null;
  }
  tokens.taken.add(token);
  if (!isReceiptToken(token)) {
    note("bill_token_malformed");
    tokens.malformed.add(row.id);
  }
  return token;
}

function payoutOf(row: LiveTransfer, customerId: string, amount: number, inputs: PayoutInputs, at: PayoutContext): ImportedPayout {
  const time = (column: string, value: unknown) => convertLiveTime(value, { table: "payment_transfers", column, key: String(row.id) }, at.report).instant;
  const paidTo = text(row.bank_account);
  if (paidTo === null) at.bankFromCustomer.push(row.id);
  return {
    payoutId: row.id,
    customerId,
    transferAmount: amount,
    transferReference: text(row.transfer_code),
    receiptToken: tokenOf(row, at.tokens, at.report),
    bankLastFour: fourOf(paidTo ?? inputs.bankAccounts.get(customerId)),
    recordedBy: text(row.created_by),
    recordedAt: time("created_at", row.created_at),
    note: text(row.note),
    proofRef: text(row.proof_image),
  };
}

/** The payout's customer and amount, or null with a note when the transfer cannot be a payout. */
function importable(row: LiveTransfer, context: CutoverContext, report: ImportReport): { customerId: string; amount: number } | null {
  const note = (kind: NoteKind): null => {
    report.notes.push({ kind, table: "payment_transfers", key: String(row.id) });
    return null;
  };
  const owner = ownerOf(context, row.customer_id);
  if (owner === null) return note("payout_customer_missing");
  if (context.houseIds.has(owner.customerId)) return note("payout_to_guest");
  const amount = wholeDong(row.amount, { allowZero: true });
  if (amount === null) return note("payout_amount_not_whole_dong");
  if (owner.via === "alias") note("payout_customer_via_alias");
  return { customerId: owner.customerId, amount };
}

function sectionOf(out: Pick<LivePayouts, "payouts" | "items">, linker: Linker, inputs: PayoutInputs, at: PayoutContext): PayoutsSection {
  const byPayout = new Map<number, ImportedPayoutItem[]>();
  for (const item of out.items) {
    const list = byPayout.get(item.payoutId);
    if (list) list.push(item);
    else byPayout.set(item.payoutId, [item]);
  }
  const itemsOf = (id: number): readonly ImportedPayoutItem[] => byPayout.get(id) ?? [];
  const isGuest = (id: string | null) => id === null || inputs.context.houseIds.has(id);
  return {
    imported: out.payouts.length,
    items: out.items.length,
    receiptTokens: out.payouts.filter((p) => p.receiptToken !== null && !at.tokens.malformed.has(p.payoutId)).length,
    bankFromCustomerAtImport: at.bankFromCustomer,
    paidWithoutPayout: inputs.orders
      .filter((o) => o.status === "PAID" && !isGuest(o.customerId) && !linker.linked.has(o.orderId))
      .map((o) => ({ orderId: o.orderId, customerId: o.customerId ?? "", cashback: o.cashback }))
      .sort((a, b) => (a.orderId < b.orderId ? -1 : 1)),
    payoutsWithoutOrders: out.payouts.filter((p) => itemsOf(p.payoutId).length === 0).map((p) => p.payoutId),
    itemDifferences: out.payouts
      .map((p) => ({ payoutId: p.payoutId, transfer: p.transferAmount, items: sumDong(itemsOf(p.payoutId).map((i) => i.amount)) }))
      .filter((d) => itemsOf(d.payoutId).length > 0 && d.items !== d.transfer),
  };
}

export function readLivePayouts(source: BetterSqlite3.Database, inputs: PayoutInputs, report: ImportReport): LivePayouts {
  const rows = source.prepare("SELECT * FROM payment_transfers ORDER BY id").all() as LiveTransfer[];
  const linker = linkerOf(inputs, report);
  const at: PayoutContext = { tokens: { taken: new Set(), malformed: new Set() }, bankFromCustomer: [], report };
  const out: Omit<LivePayouts, "section"> = { payouts: [], items: [], seeds: [], listed: [] };
  for (const row of rows) {
    const found = importable(row, inputs.context, report);
    if (found === null) continue;
    out.payouts.push(payoutOf(row, found.customerId, found.amount, inputs, at));
    out.items.push(...linker.itemsOf(row, found.customerId));
    const key = dedupKey("payout", String(row.id), "recorded");
    const sentAt = convertLiveTime(row.notified_at, { table: "payment_transfers", column: "notified_at", key: String(row.id) }, report).instant;
    const told = row.notified_at !== null && row.notified_at !== undefined && row.notified_at !== "";
    if (told) out.seeds.push({ dedupKey: key, customerId: found.customerId, messageKey: "payout_recorded", sentAt });
    else out.listed.push(key);
  }
  return { ...out, section: sectionOf(out, linker, inputs, at) };
}
