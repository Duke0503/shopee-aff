import { describe, expect, it } from "vitest";
import { handleCommand, type CommandDeps } from "../src/commands";

const deps = (orders: unknown = [], throws = false): CommandDeps => ({
  myOrders: async () => {
    if (throws) throw new Error("offline");
    return orders as never;
  },
});

describe("handleCommand", () => {
  it("ignores plain chat", async () => {
    expect(await handleCommand("xin chao", "C1", deps())).toEqual({ kind: "not_a_command" });
  });

  it("answers /donhang with the customer's orders", async () => {
    const outcome = await handleCommand("/donhang", "C1", deps([{ orderId: "O1" }]));
    expect(outcome).toEqual({ kind: "orders", orders: [{ orderId: "O1" }] });
  });

  it("asks the server for the orders of the customer who typed", async () => {
    const asked: string[] = [];
    const d: CommandDeps = {
      myOrders: async (customerId) => {
        asked.push(customerId);
        return [];
      },
    };
    await handleCommand("/donhang", "DP00012", d);
    expect(asked).toEqual(["DP00012"]);
  });

  it("answers /bank with a prompt", async () => {
    expect(await handleCommand("/bank", "C1", deps())).toEqual({ kind: "bank_prompt" });
  });

  it("reports an unknown command instead of staying silent", async () => {
    expect(await handleCommand("/xyz", "C1", deps())).toEqual({ kind: "unknown", command: "xyz" });
  });

  it("still replies when the server is unreachable", async () => {
    expect(await handleCommand("/donhang", "C1", deps([], true))).toEqual({
      kind: "orders",
      orders: [],
    });
  });
});
