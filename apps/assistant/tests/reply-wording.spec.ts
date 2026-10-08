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
  unknown_command: "unknown {command} :: {commands}",
  command_list: "list",
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
      "unknown_command",
      "command_list",
    ];
    for (const key of used) {
      expect(real[key], `missing message key: ${key}`).toBeTypeOf("string");
    }
  });
});
