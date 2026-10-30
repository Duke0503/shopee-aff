import "reflect-metadata";

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPublicApp } from "../src/create-app";
import { formatVnd, loadMessages, render } from "../src/notifications";

const id = randomBytes(6).toString("hex");
const dbPath = join(tmpdir(), `cashback-site-${id}.db`);
const labelsFile = join(tmpdir(), `cashback-labels-${id}.json`);

const MESSAGES_PATH = fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url));

let app: NestFastifyApplication;
let server: FastifyInstance;

beforeAll(async () => {
  writeFileSync(labelsFile, JSON.stringify({ _note: "a note for the editor", title: "Title", hello: "Hi" }));
  new Database(dbPath).close();

  process.env.DB_PATH = dbPath;
  process.env.LABELS_PATH = labelsFile;
  app = await createPublicApp();
  await app.init();
  server = app.getHttpAdapter().getInstance() as FastifyInstance;
});

afterAll(async () => {
  await app?.close();
});

describe("GET /api/labels", () => {
  it("serves the web labels without the editor notes, and needs no login", async () => {
    const res = await server.inject({ method: "GET", url: "/api/labels" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: "Title", hello: "Hi" });
  });
});

describe("GET /api/site", () => {
  it("serves the public figures, built from the message file", async () => {
    const messages = loadMessages(MESSAGES_PATH);
    const res = await server.inject({ method: "GET", url: "/api/site" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      rate: "80%",
      reduced: "80%",
      days: render(messages, "payout_window"),
      example_order: formatVnd(messages, 200_000),
      example_commission: "8%",
      example_cashback: formatVnd(messages, 12_800),
    });
  });
});
