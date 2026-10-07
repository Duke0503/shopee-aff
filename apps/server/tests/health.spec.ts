import "reflect-metadata";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInternalApp, createPublicApp } from "../src/create-app";

const TOKEN = "test-assistant-token-0123456789abcdef";

describe("dual listeners (ADR-16)", () => {
  let publicApp: NestFastifyApplication;
  let internalApp: NestFastifyApplication;

  beforeAll(async () => {
    process.env.ASSISTANT_TOKEN = TOKEN;
    publicApp = await createPublicApp();
    await publicApp.init();
    internalApp = await createInternalApp();
    await internalApp.init();
  });

  afterAll(async () => {
    await publicApp?.close();
    await internalApp?.close();
  });

  const server = (app: NestFastifyApplication): FastifyInstance =>
    app.getHttpAdapter().getInstance() as FastifyInstance;

  it("public /health returns 200 without a token", async () => {
    const res = await server(publicApp).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("internal /health returns 401 without a token", async () => {
    const res = await server(internalApp).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(401);
  });

  it("internal /health returns 200 with the token", async () => {
    const res = await server(internalApp).inject({
      method: "GET",
      url: "/health",
      headers: { "x-assistant-token": TOKEN },
    });
    expect(res.statusCode).toBe(200);
  });
});
