import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMessages, type Messages } from "../src/messages";
import { wordingFor, type WordingContext } from "../src/reply-wording";

const messages: Messages = {
  link_ready_no_estimate: "link {link} rate {rate} days {days}",
  received: "received",
  link_failed: "failed",
  orders_empty: "empty",
  orders_summary: "summary {count} :: {orders} :: {customer_id}",
  order_item_recent: "{index}. {order_id} ({date}) {cashback}",
  need_bank: "need bank",
  bank_saved: "saved {name}",
  bank_current: "current {name}",
  account_id: "code {customer_id} zalo {zalo_id}",
  password_issued: "password {customer_id} {password}",
  password_failed: "no password",
  unknown_command: "unknown {command} :: {commands}",
  command_list: "list",
  balance_empty: "empty balance",
  balance_summary: "bal {approved} {awaiting} {paid} {status_line}",
  balance_ready: "ready",
  balance_need_bank: "need bank",
  tax_clause_full: "",
  ping: "pong",
  topdeal_header: "top {deals}",
  topdeal_item: "{index} {name} {cashback}",
  topdeal_empty: "no deals",
};

const ctx: WordingContext = { customerId: "DP00012", ratePercent: "80", attributionDays: 7 };

describe("wordingFor", () => {
  it("sends nothing when the reply is silent", () => {
    expect(wordingFor(messages, { kind: "silent" }, ctx)).toBeNull();
  });

  it("maps a ready link to the message that needs no estimate", () => {
    const worded = wordingFor(messages, { kind: "link", affiliateUrl: "u1" }, ctx);
    expect(worded).toEqual({
      key: "link_ready_no_estimate",
      values: { link: "u1", rate: "80", days: 7, tax_clause: "" },
    });
  });

  it("uses the empty list for no orders and the summary for some", () => {
    expect(wordingFor(messages, { kind: "orders", orders: [] }, ctx)?.key).toBe("orders_empty");
    const one = wordingFor(
      messages,
      {
        kind: "orders",
        orders: [{ orderId: "O1", status: "approved", orderValueVnd: 1000, cashbackVnd: 20000, recordedAt: "2026-10-01", paidAt: null }],
      },
      ctx,
    );
    expect(one?.key).toBe("orders_summary");
    expect(String(one?.values.orders)).toContain("1. O1 (2026-10-01) 20.000");
    expect(one?.values.customer_id).toBe("DP00012");
  });

  it("names the saved bank details", () => {
    const worded = wordingFor(
      messages,
      { kind: "bank_saved", details: { bankName: "VCB", bankAccount: "123", accountHolder: "" } },
      ctx,
    );
    expect(worded).toEqual({ key: "bank_saved", values: { name: "VCB - 123" } });
  });

  it("lists an unknown command alongside the command list", () => {
    const worded = wordingFor(messages, { kind: "unknown_command", command: "xyz" }, ctx);
    expect(worded).toEqual({ key: "unknown_command", values: { command: "xyz", commands: "list" } });
  });

  it("shows the login code and the Zalo id for /id", () => {
    const worded = wordingFor(messages, { kind: "account", customerId: "C1", customerCode: "DP00012" }, ctx);
    expect(worded).toEqual({ key: "account_id", values: { customer_id: "DP00012", zalo_id: "C1" } });
  });

  it("shows the code and the new password for /matkhau", () => {
    const worded = wordingFor(
      messages,
      { kind: "password", customerId: "C1", customerCode: null, password: "ABCDEFGH" },
      ctx,
    );
    expect(worded).toEqual({
      key: "password_issued",
      values: { customer_id: "C1", password: "ABCDEFGH" },
    });
  });

  it("shows a saved account, and asks for one when there is none", () => {
    const saved = wordingFor(
      messages,
      {
        kind: "bank_current",
        bank: { hasBank: true, bankName: "VCB", bankAccount: "123", accountHolder: "LAN" },
      },
      ctx,
    );
    expect(saved).toEqual({ key: "bank_current", values: { name: "VCB - 123 - LAN" } });

    const none = wordingFor(
      messages,
      { kind: "bank_current", bank: { hasBank: false, bankName: null, bankAccount: null, accountHolder: null } },
      ctx,
    );
    expect(none).toEqual({ key: "need_bank", values: {} });
  });

  it("says the balance is empty only when there is nothing at all", () => {
    const empty = wordingFor(
      messages,
      { kind: "balance", balance: { approvedWaitingVnd: 0, stillWithShopVnd: 0, alreadyPaidVnd: 0 }, hasBank: false },
      ctx,
    );
    expect(empty).toEqual({ key: "balance_empty", values: {} });

    const some = wordingFor(
      messages,
      { kind: "balance", balance: { approvedWaitingVnd: 9506, stillWithShopVnd: 0, alreadyPaidVnd: 0 }, hasBank: true },
      ctx,
    );
    expect(some?.key).toBe("balance_summary");
    expect(some?.values.status_line).toBe("ready");
  });

  it("passes the policy rate into a fixed-key sentence", () => {
    const worded = wordingFor(messages, { kind: "static", key: "ping" }, ctx);
    expect(worded).toEqual({
      key: "ping",
      values: { rate: "80", days: 7, tax_clause: "", tax_clause_full: "" },
    });
  });
});

describe("the real message file", () => {
  const real = loadMessages(
    fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url)),
  );

  it("has every key the wording uses", () => {
    const used = [
      "link_ready_no_estimate",
      "received",
      "link_failed",
      "orders_empty",
      "orders_summary",
      "order_item_recent",
      "need_bank",
      "bank_saved",
      "bank_current",
      "account_id",
      "password_issued",
      "password_failed",
      "unknown_command",
      "command_list",
      "balance_summary",
      "balance_empty",
      "balance_ready",
      "balance_need_bank",
      "topdeal_header",
      "topdeal_item",
      "topdeal_empty",
      "tax_clause_full",
      "ping",
      "website",
      "rules",
      "policy",
      "terms",
      "bank_deleted",
    ];
    for (const key of used) {
      expect(real[key], `missing message key: ${key}`).toBeTypeOf("string");
    }
  });
});
