import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_UID, buildAuthApp, loginCookie } from "./helpers/auth-app";

describe("customer pages (session-guarded)", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    ({ app, server } = await buildAuthApp());
    cookie = await loginCookie(server);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET /api/me without a cookie is 401", async () => {
    expect((await server.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("GET /api/me returns the signed-in customer", async () => {
    const res = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customerId).toBe(TEST_UID);
    expect(res.json().hasBankDetails).toBe(false);
  });

  it("saves and erases bank details", async () => {
    const saved = await server.inject({
      method: "POST",
      url: "/api/me/bank",
      headers: { cookie },
      payload: { bankName: "VCB", bankAccount: "123", accountHolder: "LE VAN C" },
    });
    expect(saved.statusCode).toBe(201);

    const afterSave = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(afterSave.json().hasBankDetails).toBe(true);

    const erased = await server.inject({ method: "DELETE", url: "/api/me/bank", headers: { cookie } });
    expect(erased.statusCode).toBe(200);

    const afterErase = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(afterErase.json().hasBankDetails).toBe(false);
  });

  it("rejects a forged cookie", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: "cashback_session=not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});
