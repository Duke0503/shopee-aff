/**
 * Story 5.3 AC4 (INV-10, D8): the extension holds no Shopee signature construction and calls no
 * Shopee API; it drives the page's own form and talks only to the server on 127.0.0.1. Checked on
 * the source and the manifest; the settings rule and the server client are checked with a fake
 * fetch, never the network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_INSTANCE_HEADER, BRIDGE_TOKEN_HEADER } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { loopbackOrigin, parseSettings } from "../src/bridge-settings";
import { serverClient, type Fetch } from "../src/server-client";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts")).map((f) => ({ file: f, text: readFileSync(join(ROOT, "src", f), "utf8") }));
const code = (text: string) => text.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Story 5.3 AC4: no Shopee signature and no direct Shopee API call", () => {
  it("the source builds no signature header, names no Shopee API path and adds no request header but the bridge token", () => {
    const forbidden = /af-ac-enc|x-sap-|x-csrftoken|x-api-source|x-shopee|signature|hmac|crypto\.subtle|\/api\/v\d|\/gql|graphql|open-api/i;
    for (const { file, text } of SOURCES) expect(`${file}: ${code(text).match(forbidden)?.[0] ?? ""}`).toBe(`${file}: `);
  });

  it("only the server client and the worker's wiring touch fetch, and no page script calls the network", () => {
    const users = SOURCES.filter(({ text }) => /\bfetch(Fn)?\b|XMLHttpRequest|WebSocket|sendBeacon/.test(code(text))).map((s) => s.file).sort();
    expect(users).toEqual(["background.ts", "bridge-service.ts", "server-client.ts"]);
    const page = SOURCES.find((s) => s.file === "page-scripts.ts")?.text ?? "";
    expect(code(page)).not.toMatch(/fetch|XMLHttpRequest|chrome\./);
  });

  it("the manifest reaches only the affiliate dashboard and 127.0.0.1, with no debugger permission", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.json"), "utf8")) as { manifest_version: number; permissions: string[]; host_permissions: string[]; background: { type: string } };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(["https://affiliate.shopee.vn/*", "http://127.0.0.1/*"]);
    expect(manifest.permissions.sort()).toEqual(["alarms", "scripting", "storage", "tabs"]);
    expect(manifest.background.type).toBe("module");
  });

  it("AC2: no page script sets a timer or waits: each is one synchronous look, every wait is in the worker", () => {
    const page = code(SOURCES.find((s) => s.file === "page-scripts.ts")?.text ?? "");
    expect(page).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|await |async |new Promise|MutationObserver/);
  });

  it("the source holds no Vietnamese letters and no emoji", () => {
    for (const { file, text } of SOURCES) expect(`${file}: ${/[^\t\n\r -~]/.test(text)}`).toBe(`${file}: false`);
  });
});

describe("Story 5.3: the token goes only to this machine's internal listener", () => {
  it("accepts only http://127.0.0.1:<port> with nothing after it, and a token of at least 32 characters", () => {
    expect(loopbackOrigin("http://127.0.0.1:9081")).toBe("http://127.0.0.1:9081");
    expect(loopbackOrigin(" http://127.0.0.1:9081/ ")).toBe("http://127.0.0.1:9081");
    for (const bad of ["https://127.0.0.1:9081", "http://localhost:9081", "http://127.0.0.1", "http://127.0.0.1:9081/x", "http://192.168.1.2:9081", "http://u:p@127.0.0.1:9081", "http://127.0.0.1.evil.com:9081", "http://hoantiendp.com:9081"]) expect(loopbackOrigin(bad)).toBeNull();
    expect(parseSettings({ serverUrl: "http://127.0.0.1:9081", token: "b".repeat(40) })).toEqual({ serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40) });
    expect(parseSettings({ serverUrl: "http://127.0.0.1:9081", token: "short" })).toBeNull();
    expect(parseSettings({ serverUrl: "http://127.0.0.1:9081" })).toBeNull();
  });

  it("polls and posts with the bridge token, reads 204 as no work and 401 as a refused token, and answers a malformed job bad_job", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const replies = [
      { status: 204, body: null },
      { status: 401, body: null },
      { status: 200, body: { ticket: "a".repeat(32), kind: "link", sourceUrl: "https://shopee.vn/x", subId1: "A-B", subId2: "C", timeoutMs: 90_000 } },
      { status: 200, body: { accepted: true } },
      { status: 503, body: null },
    ];
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, ...init });
      const reply = replies.shift() ?? { status: 500, body: null };
      return { status: reply.status, json: async () => reply.body };
    };
    const client = serverClient({ serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40), instance: "c".repeat(32) }, fetch);
    expect(await client.next()).toEqual({ kind: "idle" });
    expect(await client.next()).toEqual({ kind: "unauthorized" });
    expect(await client.next()).toEqual({ kind: "idle" });
    await expect(client.next()).rejects.toThrow("503");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://127.0.0.1:9081/internal/bridge/next",
      "GET http://127.0.0.1:9081/internal/bridge/next",
      "GET http://127.0.0.1:9081/internal/bridge/next",
      "POST http://127.0.0.1:9081/internal/bridge/results",
      "GET http://127.0.0.1:9081/internal/bridge/next",
    ]);
    expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({ ticket: "a".repeat(32), outcome: "failed", reason: "bad_job" });
    for (const c of calls) expect([c.headers[BRIDGE_TOKEN_HEADER], c.headers[BRIDGE_INSTANCE_HEADER]]).toEqual(["b".repeat(40), "c".repeat(32)]);
  });
});
