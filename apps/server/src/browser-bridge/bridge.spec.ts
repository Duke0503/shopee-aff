import { describe, expect, it } from "vitest";

import { Bridge } from "./bridge";
import { createBridgeServer } from "./bridge.service";

const TOKEN = "test-bridge-token";

function makeBridge(): Bridge {
  return new Bridge({ token: TOKEN, hosts: ["affiliate.shopee.vn"], landingUrl: "https://x" });
}

describe("Bridge (unit)", () => {
  it("hands a job to the extension and resolves /execute with its result", async () => {
    const bridge = makeBridge();
    const pending = bridge.submit({ id: "j1", action: "click", params: {} }, 5000);
    expect(bridge.nextJob(0, 120_000)?.id).toBe("j1");
    expect(bridge.deliver("j1", { ok: true, value: 7 })).toBe(true);
    await expect(pending).resolves.toBe(7);
  });

  it("rejects /execute when the extension never answers", async () => {
    const bridge = makeBridge();
    await expect(bridge.submit({ id: "j1", action: "click", params: {} }, 10)).rejects.toThrow(
      /timed out/,
    );
  });

  it("reports delivery of an unknown job as false", () => {
    expect(makeBridge().deliver("nope", { ok: true })).toBe(false);
  });
});

describe("bridge server", () => {
  const server = createBridgeServer(makeBridge(), { now: () => 1000 });

  it("rejects a bad or missing token", async () => {
    expect((await server.inject({ method: "GET", url: "/status" })).statusCode).toBe(401);
    expect(
      (await server.inject({ method: "GET", url: "/status", headers: { "x-bridge-token": "no" } }))
        .statusCode,
    ).toBe(401);
  });

  it("reports status for an authorised caller", async () => {
    const res = await server.inject({ method: "GET", url: "/status", headers: { "x-bridge-token": TOKEN } });
    expect(res.json()).toEqual({ ok: true, connected: false, instances: 0, queued_jobs: 0 });
  });

  it("returns 204 from /job when there is nothing to do", async () => {
    const res = await server.inject({ method: "GET", url: "/job", headers: { "x-bridge-token": TOKEN } });
    expect(res.statusCode).toBe(204);
  });

  it("registers an instance and reports it connected", async () => {
    await server.inject({
      method: "POST",
      url: "/register",
      headers: { "x-bridge-token": TOKEN },
      payload: { uuid: "ext-1" },
    });
    const res = await server.inject({ method: "GET", url: "/status", headers: { "x-bridge-token": TOKEN } });
    expect(res.json().connected).toBe(true);
  });
});
