/**
 * A migrated ledger for the Payouts tests (Stories 4.6, 4.7, 4.8, 4.11): the fake customers of
 * fixtures/payout-customers.json, two staff members, and builders for orders, bonuses, clawbacks
 * and bank accounts. Fingerprints use a test key; account numbers are made up.
 */
import { readFileSync } from "node:fs";
import { fixedClock, searchText, sortKey, type Clock } from "@cashback/core";

import { bankFingerprint } from "../../src/modules/identity/index";
import { outboxFor } from "../../src/modules/messaging/index";
import { commandAudit } from "../../src/modules/operations/index";
import { confirmPayout, openPayoutClaim, type ClaimOutcome, type ConfirmDeps, type ConfirmOutcome } from "../../src/modules/payouts/index";
import type { Ledger } from "../../src/platform/db/ledger";
import type { Actor } from "../../src/platform/ports/audit.port";
import { freshLedger } from "./order-ledger";

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/payout-customers.json", import.meta.url), "utf8")) as { customers: [string, string, string][]; holder: string; foldedQuery: string };
export const nameOf = (id: string): string => FIXTURE.customers.find(([c]) => c === id)?.[2] ?? "";
export const codeOf = (id: string): string => FIXTURE.customers.find(([c]) => c === id)?.[1] ?? "";

export const FINGERPRINT_KEY = "test-fingerprint-key-0123456789abcdef";
export const NOW = "2026-10-30T12:00:00.000Z";
export const CLOCK = fixedClock(NOW);

export const MINH: Actor = { kind: "staff", id: "minh", role: "ADMIN" };
export const TU: Actor = { kind: "staff", id: "tuan", role: "EMPLOYEE" };

export function payoutLedger(): Ledger {
  const ledger = freshLedger();
  const insert = ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name, search_text, sort_key) VALUES (?, ?, 'USER', 'ACTIVE', ?, ?, ?)");
  for (const [id, code, name] of FIXTURE.customers) insert.run(id, code, name, searchText(name, code), sortKey(name));
  const staff = ledger.sqlite.prepare("INSERT INTO staff (staff_id, username, role, status, password_hash, password_set_at, created_at) VALUES (?, ?, ?, 'ACTIVE', '$argon2id$v=19$m=19456,t=2,p=1$test$test', ?, ?)");
  staff.run("minh", "minh", "ADMIN", NOW, NOW);
  staff.run("tuan", "tuan", "EMPLOYEE", NOW, NOW);
  return ledger;
}

export interface OrderSpec {
  readonly id: string;
  readonly customer: string;
  readonly status?: "AWAITING_APPROVAL" | "APPROVED" | "FROZEN" | "REVERSED" | "PAID" | "REJECTED";
  readonly cashback?: number | null;
  readonly estimate?: number | null;
  readonly settled?: boolean;
  readonly requestId?: string | null;
  readonly approvedAt?: string;
}

export function addOrder(ledger: Ledger, o: OrderSpec): void {
  const status = o.status ?? "APPROVED";
  const approved = status === "AWAITING_APPROVAL" ? null : 100000;
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, request_id, status, estimated_commission, approved_commission, cashback, approved_at, paid_at, settled_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORT')")
    .run(o.id, o.customer, o.requestId ?? null, status, o.estimate ?? null, approved, status === "AWAITING_APPROVAL" ? null : (o.cashback ?? null), o.approvedAt ?? "2026-10-20T03:00:00.000Z", status === "PAID" ? "2026-10-01T03:00:00.000Z" : null, o.settled === true ? "2026-10-25T03:00:00.000Z" : null);
}

export function addBonus(ledger: Ledger, customer: string, orderId: string, amount: number, status = "CONFIRMED"): void {
  ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', ?, ?, ?, ?, 'RULE')").run(customer, orderId, amount, status);
}

/** An open clawback of `amount` on a PAID order of the customer (the order is created with it). */
export function addClawback(ledger: Ledger, customer: string, orderId: string, amount: number): void {
  addOrder(ledger, { id: orderId, customer, status: "PAID", cashback: amount });
  ledger.sqlite
    .prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, created_at, created_by) VALUES (?, ?, 'CLAWBACK', ?, ?, ?, 'test')")
    .run(customer, `${orderId}-1`, -amount, orderId, NOW);
}

export interface BankSpec {
  readonly bank?: string | null;
  readonly number?: string;
  readonly holder?: string | null;
  readonly held?: boolean;
  /** The consent (save) time; an old one by default. */
  readonly changedAt?: string | null;
}

export function addBank(ledger: Ledger, customer: string, spec: BankSpec = {}): void {
  const number = spec.number ?? `0071000${customer.replace(/\D/g, "").padStart(6, "0")}`;
  ledger.sqlite
    .prepare("INSERT INTO bank_accounts (customer_id, bank_name, account_number, holder_name, fingerprint, consent_at, pending_confirmation) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(customer, spec.bank === undefined ? "Vietcombank" : spec.bank, number, spec.holder === undefined ? FIXTURE.holder : spec.holder, bankFingerprint(FINGERPRINT_KEY, number), spec.changedAt === undefined ? "2026-09-01T03:00:00.000Z" : spec.changedAt, spec.held === true ? 1 : 0);
}

/** A sequence of claim ids, so tests can name them. */
export function claimIds(...ids: string[]): () => string {
  let i = 0;
  return () => ids[i++] ?? `ZZZZZZ${String(i).padStart(2, "0")}`;
}

export function openClaim(ledger: Ledger, key: string, actor: Actor = MINH, clock: Clock = CLOCK, newClaimId?: () => string): ClaimOutcome {
  return ledger.tx((db) => openPayoutClaim(db, key, { clock, by: commandAudit(db, clock, actor), ...(newClaimId === undefined ? {} : { newClaimId }) }));
}

export const claimRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT claim_id, customer_id, staff_id, status, amount, qr_shown_at, abandoned_at, transfer_reference, order_ids, award_ids, clawback_ids FROM payout_claims ORDER BY rowid").all() as Record<string, unknown>[];

/** Confirms a claim as `actor`, with the outbox of messaging, in one transaction. */
export function confirmClaim(ledger: Ledger, claimId: string, snapshotHash: string, actor: Actor = MINH, clock: Clock = CLOCK, extra: Partial<Pick<ConfirmDeps, "confirmPaused" | "newReceiptToken">> = {}): ConfirmOutcome {
  return ledger.tx((db) => {
    const by = commandAudit(db, clock, actor);
    return confirmPayout(db, { claimId, snapshotHash }, { clock, by, outbox: outboxFor(db, clock, by), newReceiptToken: () => "rcpt_test_token_0001", ...extra });
  });
}

/** Row counts of every table a confirm writes, to show that a refused or repeated confirm writes nothing. */
export function writeCounts(ledger: Ledger): Record<string, number> {
  const tables = ["payouts", "payout_items", "ledger_entries", "outbox", "audit_entries", "order_status_history"];
  return Object.fromEntries(tables.map((t) => [t, (ledger.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n]));
}
