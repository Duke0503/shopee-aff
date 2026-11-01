/**
 * Story 6.6 (assistant side): the order, clawback and payout notifications as a customer reads
 * them, written from the server's parameters. The approved notice states the amount (and asks for
 * a bank account when the server chose that notice), a rejection names its reason in words, a
 * payout carries its receipt link `/b/<token>`. AC4 checks the whole message file: every key a
 * producer uses exists, no sentence promises a payout date (D11), and every percentage comes with
 * an example amount in dong (money rule 11). The producers (keys, told once) are in
 * apps/server/tests/order-notifications.test.ts.
 */
import type { AssistantNotification } from "@cashback/contracts";
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { messageText, type MessageKey } from "../src/messages";
import { notificationMessage } from "../src/notification-text";

/** Every key the server's producers enqueue (orders, payouts, clawbacks; links are Story 6.5's). */
const PRODUCER_KEYS = [
  "notice_order",
  "notice_order_recorded",
  "notice_order_approved",
  "notice_order_approved_add_bank",
  "notice_order_approved_bank_held",
  "clawback_opened",
  "clawback_commission_dropped",
  "payout_recorded",
  "payout_voided",
] as const;

const note = (dedupKey: string, messageKey: string, params: Record<string, string | number>): AssistantNotification => ({ id: 1, dedupKey, zaloUserId: "70001", messageKey, params, link: null });
const textOf = (n: AssistantNotification): string | undefined => notificationMessage(n)?.text;
const sentence = (key: MessageKey, reason?: MessageKey) => messageText(key, reason === undefined ? {} : { reason: messageText(reason) });
const framed = (orderId: string, state: string, detail?: string) => (detail === undefined ? messageText("notice_order", { orderId, state }) : messageText("notice_order_detail", { orderId, state, detail }));

/** Words that set a time for money (a date, a day count, "within", "at the latest", "today", "tomorrow"). */
const DATE_PROMISE = /\d{1,2}\/\d{1,2}|\d+\s*(ng\u00e0y|gi\u1edd|tu\u1ea7n|th\u00e1ng)|trong v\u00f2ng|ch\u1eadm nh\u1ea5t|tr\u01b0\u1edbc ng\u00e0y|h\u00f4m nay|ng\u00e0y mai|\{(date|day|days|payoutDate)\}/iu;
/** A sentence about money: a transfer or cashback. */
const ABOUT_MONEY = /chuy\u1ec3n|ho\u00e0n ti\u1ec1n|ti\u1ec1n ho\u00e0n|nh\u1eadn l\u1ea1i/iu;
/** An amount in dong, written out or as an amount placeholder. */
const DONG_AMOUNT = /\d[\d.]*\u0111|\{(amount|cashback|payable)\}/u;

describe("Story 6.6: order, clawback and payout notifications as the customer reads them", () => {
  it("AC2: the approved notice without a bank account states the amount and asks for a bank account", () => {
    const text = textOf(note("order:261020A1:approved", "notice_order_approved_add_bank", { orderId: "261020A1", status: "APPROVED", cashback: 6228 }));
    expect(text).toBe(framed("261020A1", sentence("order_approved"), messageText("notice_order_approved_add_bank", { cashback: "6.228\u0111" })));
    expect(text).toContain("6.228\u0111");
    expect(text).toContain("/stk");
    expect(textOf(note("order:261020A2:approved", "notice_order_approved", { orderId: "261020A2", status: "APPROVED", cashback: 6228 }))).not.toContain("/stk");
  });

  it("AC2: an account waiting for confirmation gets the reminder to confirm it, not the request for an account", () => {
    const text = textOf(note("order:261020A4:approved", "notice_order_approved_bank_held", { orderId: "261020A4", status: "APPROVED", cashback: 6228 }));
    expect(text).toBe(framed("261020A4", sentence("order_approved"), messageText("notice_order_approved_bank_held", { cashback: "6.228\u0111" })));
    expect(text).not.toContain("/stk");
  });

  it("AC2: an approved notice without its amount or its order id is never sent with a raw placeholder or as a bare sentence", () => {
    expect(notificationMessage(note("order:261020A3:approved", "notice_order_approved", { orderId: "261020A3", status: "APPROVED" }))).toBeNull();
    expect(notificationMessage(note("order:261020A3:approved", "notice_order_approved", { status: "APPROVED", cashback: 6228 }))).toBeNull();
  });

  it("AC1: a cancel is told with its status sentence and its reason in words, never as a code", () => {
    const text = textOf(note("order:261020R1:rejected", "notice_order", { orderId: "261020R1", status: "REJECTED", reason: "commission_zero" }));
    expect(text).toBe(framed("261020R1", sentence("order_rejected", "rejection_reason_commission_zero")));
    expect(text).not.toContain("commission_zero");
    expect(textOf(note("order:261020R2:rejected", "notice_order", { orderId: "261020R2", status: "REJECTED", reason: "not_eligible" }))).toBe(framed("261020R2", sentence("order_rejected", "rejection_reason_not_eligible")));
    expect(textOf(note("order:261020V1:reversed", "notice_order", { orderId: "261020V1", status: "REVERSED", cashback: 5000 }))).toBe(framed("261020V1", sentence("order_reversed")));
  });

  it("rows queued before the deploy under the old registry keys are written in the notice format, never as a bare sentence", () => {
    expect(textOf(note("order:O1:approved", "order_approved", { orderId: "O1", cashback: 6228 }))).toBe(framed("O1", sentence("order_approved"), messageText("notice_order_approved", { cashback: "6.228\u0111" })));
    expect(textOf(note("order:O2:approved", "order_approved", { orderId: "O2" }))).toBe(framed("O2", sentence("order_approved")));
    expect(textOf(note("order:O3:recorded", "order_recorded", { orderId: "O3" }))).toBe(framed("O3", sentence("order_recorded"), messageText("notice_order_recorded")));
    expect(textOf(note("order:O4:rejected", "order_rejected", { orderId: "O4", reason: "order_cancelled" }))).toBe(framed("O4", sentence("order_rejected", "rejection_reason_order_cancelled")));
    expect(textOf(note("order:O5:rejected", "order_rejected", { orderId: "O5" }))).toBe(framed("O5", sentence("order_rejected", "rejection_reason_other")));
    expect(textOf(note("order:O6:reversed", "order_reversed", { orderId: "O6" }))).toBe(framed("O6", sentence("order_reversed")));
    for (const key of ["order_approved", "order_recorded", "order_rejected", "order_reversed", "order_frozen"]) expect(notificationMessage(note("order:X:x", key, {})), key).toBeNull();
  });

  it("AC3: the payout notice carries the receipt link /b/<token>; a clawback names its order and amount", () => {
    expect(textOf(note("payout:7:recorded", "payout_recorded", { payoutId: 7, amount: 79216, receiptToken: "rcpt_test_token_0001" }))).toContain("hoantiendp.com/b/rcpt_test_token_0001");
    expect(textOf(note("payout:7:recorded", "payout_recorded", { payoutId: 7, amount: 79216, receiptToken: "rcpt_test_token_0001" }))).toContain("79.216\u0111");
    expect(textOf(note("clawback:260910C1-1:opened", "clawback_opened", { clawbackId: "260910C1-1", orderId: "260910C1", amount: 9263 }))).toBe(messageText("clawback_opened", { orderId: "260910C1", amount: "9.263\u0111" }));
  });

  it("AC4: every message key used exists, none promises a date, and every percentage has an example amount", () => {
    const file = messages as Record<string, string>;
    expect(PRODUCER_KEYS.filter((k) => typeof file[k] !== "string")).toEqual([]);
    for (const [key, raw] of Object.entries(file)) {
      const text = raw.normalize("NFC");
      if (ABOUT_MONEY.test(text)) expect(text, key).not.toMatch(DATE_PROMISE);
      if (text.includes("%") || text.includes("{share}")) expect(text, key).toMatch(DONG_AMOUNT);
    }
  });

  it("AC4: the date check catches a promise and the percentage check a bare rate", () => {
    expect("M\u00ecnh s\u1ebd chuy\u1ec3n ti\u1ec1n trong v\u00f2ng 3 ng\u00e0y").toMatch(DATE_PROMISE);
    expect("B\u1ea1n nh\u1eadn l\u1ea1i 80% hoa h\u1ed3ng").not.toMatch(DONG_AMOUNT);
  });
});
