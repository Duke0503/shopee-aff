/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  canTransition,
  hasBankAccount,
  isPaidOrder,
  isPayableAward,
  isPayableOrder,
  isSettled,
  isWaitingForApproval,
  ORDER_STATUSES_IN_NO_TOTAL,
  registryKeys,
  settlementOf,
  sortByLifecycle,
  STATUS_REGISTRY,
  statusesOf,
  storedValues,
  TONES,
  type EntityName,
  type OrderStatus,
} from "../src/index";
import { flatText, paragraph, parseChain, parseOrder, readStatusFlows, sections, type DocEntity } from "./status-flows-doc";

const doc = readStatusFlows();
const bySection = sections(doc);

function section(name: string): string {
  const body = bySection.get(name);
  if (body === undefined) throw new Error(`status-flows.md has no section "${name}"`);
  return body;
}

/** Where each registry entity is defined in status-flows.md. */
const DOC_ENTITIES: Record<Exclude<EntityName, "clawback">, () => DocEntity> = {
  order: () => parseOrder(section("Order")),
  linkRequest: () => parseChain(paragraph(section("Link request"))),
  payoutClaim: () => parseChain(paragraph(section("Payout"), "**Payout claim**")),
  payout: () => parseChain(paragraph(section("Payout"), "**Payout:**")),
  campaignAward: () => parseChain(paragraph(section("Campaign award"))),
  reviewCase: () => parseChain(paragraph(section("Review case"))),
  networkSettlement: () => parseChain(paragraph(section("Network settlement"))),
  customer: () => parseChain(paragraph(section("Customer"))),
};

const SECTIONS = ["Order", "Clawback (cancel after payout)", "Link request", "Payout", "Campaign award", "Review case", "Network settlement", "Customer"];

/** Transitions status-flows.md states in prose rather than in a chain or table, each with its sentence. */
const PROSE_TRANSITIONS: { entity: EntityName; from: string; to: string; quote: string }[] = [
  { entity: "payoutClaim", from: "ABANDONED", to: "CONFIRMED", quote: "Confirm on an `ABANDONED` claim still succeeds" },
  { entity: "campaignAward", from: "CONFIRMED", to: "VOID", quote: "An award is voided whenever its order becomes `REJECTED` or `REVERSED`, whatever the campaign's own status" },
  { entity: "campaignAward", from: "PAID", to: "CONFIRMED", quote: "returns bonuses to `CONFIRMED` (or `VOID` when their order is now `REVERSED`)" },
  { entity: "campaignAward", from: "PAID", to: "VOID", quote: "returns bonuses to `CONFIRMED` (or `VOID` when their order is now `REVERSED`)" },
];

const edgeKey = ([from, to]: readonly [string, string]): string => `${from} -> ${to}`;

describe("status registry against docs/operations/status-flows.md (Story 1.8 AC1, AD-10)", () => {
  it("covers exactly the sections of status-flows.md, so an added or removed entity fails", () => {
    expect([...bySection.keys()]).toEqual(SECTIONS);
    expect(Object.keys(STATUS_REGISTRY).sort()).toEqual([...Object.keys(DOC_ENTITIES), "clawback"].sort());
  });

  for (const [entity, read] of Object.entries(DOC_ENTITIES) as [Exclude<EntityName, "clawback">, () => DocEntity][]) {
    describe(entity, () => {
      const fromDoc = read();
      const registry = STATUS_REGISTRY[entity];

      it("has the same states in the same lifecycle order", () => {
        expect(fromDoc.states.length).toBeGreaterThan(0);
        expect(statusesOf(entity).map((s) => s.value)).toEqual(fromDoc.states);
      });

      it("has the same initial state", () => {
        expect([...registry.initial]).toEqual(fromDoc.initial);
      });

      it("has the same transitions", () => {
        const prose = PROSE_TRANSITIONS.filter((p) => p.entity === entity).map((p) => edgeKey([p.from, p.to]));
        const expected = [...fromDoc.transitions.map(edgeKey), ...prose].sort();
        expect(registry.transitions.map(edgeKey).sort()).toEqual(expected);
      });
    });
  }

  it("quotes every prose transition word for word from status-flows.md", () => {
    for (const { quote } of PROSE_TRANSITIONS) expect(flatText(doc)).toContain(quote);
  });

  it("models the clawback as an entity with no status column, open while its entries sum below 0", () => {
    expect(STATUS_REGISTRY.clawback.statuses).toEqual([]);
    expect(STATUS_REGISTRY.clawback.derivedFrom).toBe("ledger_entries");
    expect(flatText(section("Clawback (cancel after payout)"))).toContain("Its open amount is the sum of its insert-only entries");
  });

  it("treats only the states the document marks payable as payable", () => {
    expect(parseOrder(section("Order")).payable).toEqual(["APPROVED"]);
    for (const status of storedValues("order")) {
      expect(isPayableOrder({ status, paidAt: null, approvedCommission: 1000 })).toBe(status === "APPROVED");
    }
  });

  it("detects a state added on either side", () => {
    const changed = section("Link request").replace("`QUEUED → FAILED`", "`QUEUED → FAILED → RETRIED`");
    expect(parseChain(paragraph(changed)).states).toContain("RETRIED");
    expect(parseChain(paragraph(changed)).states).not.toEqual(statusesOf("linkRequest").map((s) => s.value));
  });

  it("gives every status a known tone and a unique order", () => {
    for (const entity of Object.keys(STATUS_REGISTRY) as EntityName[]) {
      const statuses = statusesOf(entity);
      expect(new Set(statuses.map((s) => s.order)).size).toBe(statuses.length);
      for (const s of statuses) expect(TONES).toContain(s.tone);
    }
  });
});

describe("lifecycle order (Story 1.8 AC2)", () => {
  it("regression 'status sorts alphabetically': order statuses sort in lifecycle order", () => {
    const alphabetical: OrderStatus[] = ["APPROVED", "AWAITING_APPROVAL", "FROZEN", "PAID", "REJECTED", "REVERSED"];
    expect(sortByLifecycle("order", alphabetical)).toEqual(["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"]);
  });

  it("allows only the transitions of the document", () => {
    expect(canTransition("order", "APPROVED", "PAID")).toBe(true);
    expect(canTransition("order", "AWAITING_APPROVAL", "PAID")).toBe(false);
    expect(canTransition("order", "REVERSED", "APPROVED")).toBe(false);
  });
});

describe("customer LOCKED (Story 1.8 AC3)", () => {
  it("marks LOCKED as derived from locked_until, matching the document, and not storable", () => {
    expect(parseChain(paragraph(section("Customer"))).derived).toEqual({ LOCKED: "locked_until" });
    expect(statusesOf("customer").find((s) => s.value === "LOCKED")?.derivedFrom).toBe("locked_until");
    expect(storedValues("customer")).toEqual(["ACTIVE", "DISABLED", "MERGED", "ERASED"]);
  });
});

describe("payout claim and payout (Story 1.8 AC4)", () => {
  it("keeps the payout claim as its own entity with OPEN, CONFIRMED and ABANDONED", () => {
    expect(statusesOf("payoutClaim").map((s) => s.value)).toEqual(["OPEN", "CONFIRMED", "ABANDONED"]);
  });

  it("gives the payout only RECORDED and VOIDED", () => {
    expect(statusesOf("payout").map((s) => s.value)).toEqual(["RECORDED", "VOIDED"]);
  });
});

describe("label and message keys resolve in packages/labels (Story 1.8 AC5, D57)", () => {
  const labelFile = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../labels/vi/${name}`, import.meta.url)), "utf8")) as Record<string, unknown>;
  const statusLabels = labelFile("status.json");
  const messages = labelFile("messages.json");

  const missing = (keys: readonly string[], file: Record<string, unknown>): string[] =>
    keys.filter((k) => typeof file[k] !== "string" || (file[k] as string).length === 0);

  it("every status label key resolves in vi/status.json", () => {
    expect(missing(registryKeys().labelKeys, statusLabels)).toEqual([]);
  });

  it("every customer message key resolves in vi/messages.json", () => {
    expect(missing(registryKeys().messageKeys, messages)).toEqual([]);
  });

  it("fails on a key that resolves nowhere", () => {
    expect(missing(registryKeys().labelKeys, {})).toContain("status_approved");
    expect(missing(["status_not_defined"], statusLabels)).toEqual(["status_not_defined"]);
  });

  it("uses the customer sentences of status-flows.md for the order messages", () => {
    const orderRows = section("Order").split("\n").filter((l) => /^\| `[A-Z_]+` \|/.test(l));
    for (const row of orderRows) {
      const [state, , sentence] = row.split("|").slice(1, -1).map((c) => c.trim());
      const key = statusesOf("order").find((s) => `\`${s.value}\`` === state)?.messageKey;
      expect(key, `message key of ${state}`).toBeTruthy();
      expect(`"${(messages[key ?? ""] as string).replace("{reason}", "<reason>")}"`).toBe(sentence);
    }
  });
});

describe("shared definitions (AD-10, D27)", () => {
  it("payable: APPROVED, unpaid, approved commission above 0", () => {
    expect(isPayableOrder({ status: "APPROVED", paidAt: null, approvedCommission: 1 })).toBe(true);
    expect(isPayableOrder({ status: "APPROVED", paidAt: "2026-10-30T00:00:00.000Z", approvedCommission: 1 })).toBe(false);
    expect(isPayableOrder({ status: "APPROVED", paidAt: null, approvedCommission: 0 })).toBe(false);
  });

  it("a CONFIRMED bonus is payable, except while its order is FROZEN; a HELD one never", () => {
    expect(isPayableAward({ status: "CONFIRMED", orderStatus: "APPROVED" })).toBe(true);
    expect(isPayableAward({ status: "CONFIRMED", orderStatus: "FROZEN" })).toBe(false);
    expect(isPayableAward({ status: "HELD", orderStatus: "APPROVED" })).toBe(false);
  });

  it("waiting, paid and the statuses in no total", () => {
    expect(isWaitingForApproval("AWAITING_APPROVAL")).toBe(true);
    expect(isWaitingForApproval("FROZEN")).toBe(false);
    expect(isPaidOrder("PAID")).toBe(true);
    expect(ORDER_STATUSES_IN_NO_TOTAL).toEqual(["FROZEN", "REVERSED"]);
  });

  it("settled comes only from a PAID network settlement, with a partly settled fact", () => {
    expect(isSettled("PAID")).toBe(true);
    expect(isSettled("PROCESSING")).toBe(false);
    expect(isSettled(null)).toBe(false);
    expect(settlementOf(["PAID", "PAID"])).toBe("SETTLED");
    expect(settlementOf(["PAID", null])).toBe("PARTLY_SETTLED");
    expect(settlementOf(["FAILED"])).toBe("UNSETTLED");
  });

  it("has a bank account: saved and not waiting for confirmation", () => {
    expect(hasBankAccount({ pendingConfirmation: false })).toBe(true);
    expect(hasBankAccount({ pendingConfirmation: true })).toBe(false);
    expect(hasBankAccount(null)).toBe(false);
  });
});
