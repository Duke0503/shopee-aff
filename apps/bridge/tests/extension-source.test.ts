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
import { describe, expect, it, vi } from "vitest";

import { loopbackOrigin, parseSettings } from "../src/bridge-settings";
import { serverClient, VERIFICATION_POST_TIMEOUT_MS, type Fetch } from "../src/server-client";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts")).map((f) => ({ file: f, text: readFileSync(join(ROOT, "src", f), "utf8") }));
const code = (text: string) => text.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Story 5.3 AC4: no Shopee signature and no direct Shopee API call", () => {
  it("the source builds no signature header, names no Shopee API path but the report list the page itself asks for, and adds no request header but the bridge token", () => {
    const forbidden = /af-ac-enc|x-sap-|x-csrftoken|x-api-source|x-shopee|signature|hmac|crypto\.subtle|\/api\/v\d|\/gql|graphql|open-api/i;
    const REPORT_LIST = '"/api/v3/report/list"';
    for (const { file, text } of SOURCES) {
      const allowed = file === "shopee-page.ts" ? code(text).replace(`REPORT_API_PATH = ${REPORT_LIST}`, "") : code(text);
      expect(`${file}: ${allowed.match(forbidden)?.[0] ?? ""}`).toBe(`${file}: `);
    }
    expect(SOURCES.filter(({ text }) => code(text).includes(REPORT_LIST)).map((s) => s.file)).toEqual(["shopee-page.ts"]);
  });

  it("only the server client, the worker's wiring and the report list page script touch fetch; that script makes one plain GET with the page's cookies", () => {
    const users = SOURCES.filter(({ text }) => /\bfetch(Fn)?\b|XMLHttpRequest|WebSocket|sendBeacon/.test(code(text))).map((s) => s.file).sort();
    expect(users).toEqual(["background.ts", "bridge-service.ts", "report-api-script.ts", "server-client.ts"]);
    const page = SOURCES.find((s) => s.file === "page-scripts.ts")?.text ?? "";
    expect(code(page)).not.toMatch(/fetch|XMLHttpRequest|chrome\./);
    // The live extension's request (report_reader.py on main): same origin, GET, no header, no body.
    const report = code(SOURCES.find((s) => s.file === "report-api-script.ts")?.text ?? "");
    expect(report.match(/\bfetch\(/g)).toHaveLength(1);
    expect(report).toContain('fetch(`${input.path}?${query}`, { credentials: "include" })');
    expect(report).not.toMatch(/headers|method|body:|XMLHttpRequest|chrome\.|setTimeout|setInterval|https?:\/\//);
  });

  it("the manifest reaches only the affiliate dashboard, 127.0.0.1 and the Shopee and ShopeeFood hosts a short link resolves through (Stories 5.4, 5.11), with no debugger permission", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "public", "manifest.json"), "utf8")) as { manifest_version: number; permissions: string[]; host_permissions: string[]; background: { type: string } };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(["https://affiliate.shopee.vn/*", "http://127.0.0.1/*", "https://s.shopee.vn/*", "https://shopee.vn/*", "https://shope.ee/*", "https://*.shp.ee/*", "https://spf.shopee.vn/*", "https://shopeefood.vn/*", "https://food.shopee.vn/*"]);
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
  it("D68: the captcha cleared post carries the bridge token and no body, and reads the server's answer", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const replies = [{ status: 200, body: { cleared: true } }, { status: 200, body: { cleared: false } }, { status: 401, body: null }, { status: 503, body: null }];
    const fetch: Fetch = async (url, init) => {
      calls.push({ url, ...init });
      const reply = replies.shift() ?? { status: 500, body: null };
      return { status: reply.status, json: async () => reply.body };
    };
    const client = serverClient({ serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40), instance: "c".repeat(32) }, fetch);
    expect(await client.verificationCleared()).toBe(true);
    expect(await client.verificationCleared()).toBe(false);
    expect(await client.verificationCleared()).toBe(false);
    await expect(client.verificationCleared()).rejects.toThrow("503");
    expect(calls[0]).toEqual({ url: "http://127.0.0.1:9081/internal/bridge/verification-cleared", method: "POST", headers: { [BRIDGE_TOKEN_HEADER]: "b".repeat(40), [BRIDGE_INSTANCE_HEADER]: "c".repeat(32) }, signal: expect.any(AbortSignal) });
  });

  it("D68: a stalled captcha cleared post gives up after 10 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetch: Fetch = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const client = serverClient({ serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40), instance: "c".repeat(32) }, fetch);
      let ended = false;
      const post = client.verificationCleared().finally(() => (ended = true));
      const failed = expect(post).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(VERIFICATION_POST_TIMEOUT_MS - 1);
      expect(ended).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await failed;
      expect(VERIFICATION_POST_TIMEOUT_MS).toBe(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

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
