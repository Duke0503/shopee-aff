import { describe, expect, it } from "vitest";
import { handleCommand, type CommandDeps } from "../src/commands";

const deps = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  myOrders: async () => [],
  resolveCustomer: async () => ({ customerId: "C1", customerCode: "DP00012" }),
  issuePassword: async () => ({ customerCode: "DP00012", password: "ABCDEFGH" }),
  bankDetails: async () => ({
    hasBank: false,
    bankName: null,
    bankAccount: null,
    accountHolder: null,
  }),
  saveBank: async () => undefined,
  ...over,
});

describe("handleCommand", () => {
  it("ignores plain chat", async () => {
    expect(await handleCommand("xin chao", "C1", deps())).toEqual({ kind: "not_a_command" });
  });

  it("answers /donhang with the customer's orders", async () => {
    const d = deps({ myOrders: async () => [{ orderId: "O1" } as never] });
    expect(await handleCommand("/donhang", "C1", d)).toEqual({
      kind: "orders",
      orders: [{ orderId: "O1" }],
    });
  });

  it("asks the server for the orders of the customer who typed", async () => {
    const asked: string[] = [];
    const d = deps({
      myOrders: async (customerId) => {
        asked.push(customerId);
        return [];
      },
    });
    await handleCommand("/donhang", "DP00012", d);
    expect(asked).toEqual(["DP00012"]);
  });

  it("answers /id with the code the customer logs in with", async () => {
    expect(await handleCommand("/id", "C1", deps())).toEqual({
      kind: "account",
      customerId: "C1",
      customerCode: "DP00012",
    });
  });

  it("issues a password on /matkhau", async () => {
    expect(await handleCommand("/matkhau", "C1", deps())).toEqual({
      kind: "password",
      customerId: "C1",
      customerCode: "DP00012",
      password: "ABCDEFGH",
    });
  });

  it("says so plainly when a password cannot be issued", async () => {
    const d = deps({
      issuePassword: async () => {
        throw new Error("offline");
      },
    });
    expect(await handleCommand("/matkhau", "C1", d)).toEqual({ kind: "password_failed" });
  });

  it("shows the saved account for a bare /bank", async () => {
    const d = deps({
      bankDetails: async () => ({
        hasBank: true,
        bankName: "VCB",
        bankAccount: "123",
        accountHolder: "LAN",
      }),
    });
    expect(await handleCommand("/bank", "C1", d)).toEqual({
      kind: "bank_current",
      bank: { hasBank: true, bankName: "VCB", bankAccount: "123", accountHolder: "LAN" },
    });
  });

  it("asks for an account when none is saved", async () => {
    expect(await handleCommand("/bank", "C1", deps())).toEqual({ kind: "bank_needs_details" });
  });

  it("saves the account when one is given", async () => {
    const saved: unknown[] = [];
    const d = deps({
      saveBank: async (_customerId, details) => {
        saved.push(details);
      },
    });
    const outcome = await handleCommand("/bank VCB 123 LAN", "C1", d);
    expect(outcome.kind).toBe("bank_saved");
    expect(saved).toEqual([{ bankName: "VCB", bankAccount: "123", accountHolder: "LAN" }]);
  });

  it("reports an unknown command instead of staying silent", async () => {
    expect(await handleCommand("/xyz", "C1", deps())).toEqual({ kind: "unknown", command: "xyz" });
  });

  it("still replies when the server is unreachable", async () => {
    const d = deps({
      myOrders: async () => {
        throw new Error("offline");
      },
    });
    expect(await handleCommand("/donhang", "C1", d)).toEqual({ kind: "orders", orders: [] });
  });
});
