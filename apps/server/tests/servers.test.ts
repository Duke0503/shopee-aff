import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_STATUS, errorEnvelopeSchema, healthResponseSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";

import { LedgerBusyError } from "../src/platform/db/transaction";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, listen, LOOPBACK, type Servers } from "../src/platform/http/servers";

const TOKEN = "t".repeat(40);
let servers: Servers | undefined;

function make(): Servers {
  servers = buildServers({ clock: fixedClock("2026-10-30T12:00:00.000Z"), internalToken: TOKEN });
  return servers;
}

afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
});

describe("public listener", () => {
  it("answers the health route with the shared contract", async () => {
    const res = await make().publicApp.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: "ok", service: "cashback-server", checkedAt: "2026-10-30T12:00:00.000Z" });
  });

  it("does not serve internal routes at all", async () => {
    const res = await make().publicApp.inject({ method: "GET", url: "/internal/ping", headers: { [INTERNAL_TOKEN_HEADER]: TOKEN } });
    expect(res.statusCode).toBe(404);
  });

  it("returns the error envelope for an unknown route, without a stack trace", async () => {
    const res = await make().publicApp.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(res.json())).toEqual({ error: { code: "not_found", messageKey: "error.not_found" } });
    expect(res.body).not.toMatch(/at .*\.ts/);
  });

  it("ignores X-Forwarded-For (trustProxy off)", async () => {
    const app = make().publicApp;
    app.get("/api/whoami", async (request) => ({ ip: request.ip }));
    const res = await app.inject({ method: "GET", url: "/api/whoami", headers: { "x-forwarded-for": "8.8.8.8" }, remoteAddress: "127.0.0.1" });
    expect(res.json()).toEqual({ ip: "127.0.0.1" });
  });
});

describe("client errors keep their status", () => {
  it("answers malformed JSON with 400 invalid_request, not 500", async () => {
    const app = make().publicApp;
    app.post("/api/echo", async (request) => request.body as object);
    const res = await app.inject({ method: "POST", url: "/api/echo", headers: { "content-type": "application/json" }, payload: "{bad" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "invalid_request", messageKey: "error.invalid_request" } });
  });

  it("answers a body over the limit with 413 in the envelope", async () => {
    const app = make().publicApp;
    app.post("/api/echo", async (request) => request.body as object);
    const res = await app.inject({ method: "POST", url: "/api/echo", headers: { "content-type": "application/json" }, payload: JSON.stringify({ a: "x".repeat(70_000) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("invalid_request");
  });
});

describe("internal listener", () => {
  it("rejects a request without the token in the error envelope", async () => {
    const res = await make().internalApp.inject({ method: "GET", url: "/internal/ping" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "unauthorized", messageKey: "error.unauthorized" } });
  });

  it("accepts the right token and rejects a wrong one", async () => {
    const app = make().internalApp;
    expect((await app.inject({ method: "GET", url: "/internal/ping", headers: { [INTERNAL_TOKEN_HEADER]: TOKEN } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/internal/ping", headers: { [INTERNAL_TOKEN_HEADER]: "x".repeat(40) } })).statusCode).toBe(401);
  });

  it("refuses a short token at startup", () => {
    expect(() => buildServers({ clock: fixedClock("2026-10-30T12:00:00.000Z"), internalToken: "short" })).toThrow();
  });
});

describe("listening", () => {
  it("binds both listeners to 127.0.0.1 and closes cleanly", async () => {
    const s = make();
    await listen(s, { public: 0, internal: 0 });
    for (const app of [s.publicApp, s.internalApp]) {
      const address = app.server.address() as AddressInfo;
      expect(address.address).toBe(LOOPBACK);
    }
    await close(s);
    servers = undefined;
    expect(s.publicApp.server.listening).toBe(false);
  });
});

describe("busy ledger in the error envelope (review item 9)", () => {
  it("answers 503 with code busy when a command meets a busy ledger", async () => {
    const app = make().publicApp;
    app.get("/api/busy", async () => {
      throw new LedgerBusyError();
    });
    const res = await app.inject({ method: "GET", url: "/api/busy" });
    expect(res.statusCode).toBe(503);
    expect(errorEnvelopeSchema.parse(res.json())).toEqual({ error: { code: "busy", messageKey: "error.busy" } });
  });

  it("maps the busy code to 503 in the shared contract", () => {
    expect(ERROR_CODES).toContain("busy");
    expect(ERROR_STATUS.busy).toBe(503);
  });
});
