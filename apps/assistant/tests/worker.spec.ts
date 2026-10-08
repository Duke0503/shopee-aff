import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FakeZaloClient } from "../src/fake-zalo-client";
import { loadMessages } from "../src/messages";
import { createWorker, type WorkerDeps } from "../src/worker";

const messages = loadMessages(
  fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url)),
);

function build(over: Partial<Omit<WorkerDeps, "client">> = {}) {
  const client = new FakeZaloClient();
  const deps: WorkerDeps = {
    client,
    routing: { env: "production", mainGroupId: "G1", listenGroupIds: ["G2"] },
    messages,
    api: {
      convert: async () => ({
        ready: true,
        affiliate_url: "https://s.shopee.vn/aff",
        request_id: "R1",
        house: false,
      }),
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
    },
    now: () => 0,
    sleep: async () => undefined,
    minGapMs: 0,
    friendRequests: { minGapMs: 5000, maxPerRun: 2 },
    ratePercent: "80",
    attributionDays: 7,
    ...over,
  };
  return { client, worker: createWorker(deps) };
}

const incoming = (over: Partial<{ chatId: string; text: string; isPrivate: boolean }> = {}) => ({
  chatId: "C1",
  senderId: "C1",
  text: "https://shopee.vn/item",
  isPrivate: true,
  ...over,
});

describe("the assistant worker", () => {
  it("answers a private paste with the personal link", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming());
    expect(client.sent[0]?.text).toContain("https://s.shopee.vn/aff");
  });

  it("never posts to the main group from a dev copy", async () => {
    const { client, worker } = build({
      routing: { env: "dev", mainGroupId: "G1", listenGroupIds: ["G1"] },
    });
    await worker.onMessage(incoming({ chatId: "G1", isPrivate: false }));
    expect(client.sent).toHaveLength(0);
  });

  it("stays quiet in a group it does not listen to", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming({ chatId: "G9", isPrivate: false }));
    expect(client.sent).toHaveLength(0);
  });

  it("stays silent on plain chat", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming({ text: "xin chao" }));
    expect(client.sent).toHaveLength(0);
  });

  it("answers /donhang with the empty-orders message", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming({ text: "/donhang" }));
    expect(client.sent[0]?.text).toContain("chưa có đơn hàng nào");
  });

  it("answers /id with the customer's code", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming({ text: "/id" }));
    expect(client.sent[0]?.text).toContain("DP00012");
  });

  it("shows the saved bank account on a bare /bank", async () => {
    const { client, worker } = build({
      api: {
        convert: async () => ({
          ready: true,
          affiliate_url: "https://s.shopee.vn/aff",
          request_id: "R1",
          house: false,
        }),
        myOrders: async () => [],
        resolveCustomer: async () => ({ customerId: "C1", customerCode: "DP00012" }),
        issuePassword: async () => ({ customerCode: "DP00012", password: "ABCDEFGH" }),
        bankDetails: async () => ({
          hasBank: true,
          bankName: "VCB",
          bankAccount: "123",
          accountHolder: "LAN",
        }),
        saveBank: async () => undefined,
      },
    });
    await worker.onMessage(incoming({ text: "/bank" }));
    expect(client.sent[0]?.text).toContain("VCB - 123 - LAN");
  });

  it("names an unknown command and offers the command list", async () => {
    const { client, worker } = build();
    await worker.onMessage(incoming({ text: "/xyz" }));
    expect(client.sent[0]?.text).toContain("xyz");
    expect(client.sent[0]?.text).toContain("/donhang");
  });

  it("paces a burst to one chat", async () => {
    const slept: number[] = [];
    const { client, worker } = build({
      minGapMs: 1500,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await worker.onMessage(incoming({ text: "/donhang" }));
    await worker.onMessage(incoming({ text: "/donhang" }));
    expect(slept).toEqual([1500]);
    expect(client.sent).toHaveLength(2);
  });

  it("waits out the friend-request gap and stops at the cap", async () => {
    const { client, worker } = build();
    expect(await worker.maybeAddFriend("U1", "hi")).toBe(true);
    expect(await worker.maybeAddFriend("U2", "hi")).toBe(false);
    expect(client.friendRequests).toHaveLength(1);
  });

  it("stops at the friend-request cap when requests are spread out", async () => {
    let clock = 0;
    const { client, worker } = build({
      now: () => clock,
      friendRequests: { minGapMs: 0, maxPerRun: 2 },
    });
    expect(await worker.maybeAddFriend("U1", "hi")).toBe(true);
    clock += 1;
    expect(await worker.maybeAddFriend("U2", "hi")).toBe(true);
    clock += 1;
    expect(await worker.maybeAddFriend("U3", "hi")).toBe(false);
    expect(client.friendRequests).toHaveLength(2);
  });
});
