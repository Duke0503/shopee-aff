import "reflect-metadata";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAuthApp, loginCookie, TEST_CODE, TEST_PASSWORD } from "./helpers/auth-app";

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

describe("POST /api/auth/password", () => {
  it("requires a session", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/password",
      payload: { current: TEST_PASSWORD, replacement: "NEWPASS99" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong current password", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: { current: "NOPE", replacement: "NEWPASS99" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("wrong_password");
  });

  it("rejects a replacement shorter than an issued password", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: { current: TEST_PASSWORD, replacement: "SHORT" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("too_short");
  });

  it("changes the password, so the old one stops working", async () => {
    const changed = await server.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie },
      payload: { current: TEST_PASSWORD, replacement: "NEWPASS99" },
    });
    expect(changed.statusCode).toBe(201);

    const old = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { name: TEST_CODE, password: TEST_PASSWORD },
    });
    expect(old.statusCode).toBe(401);

    const fresh = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { name: TEST_CODE, password: "NEWPASS99" },
    });
    expect(fresh.statusCode).toBe(201);
  });
});
