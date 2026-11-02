// @vitest-environment node
/**
 * Story 7.1 AC5: the built website is scanned for secrets, for Vietnamese text that does not come
 * from the imported label files, and for any module of packages/money. The build runs here with
 * the real Vite config into a temporary folder, with a plugin that records every module id. The
 * same build guards AC3: what Home loads first stays inside the size the 4G trace was measured
 * with (scripts/perf-trace.mjs, Home interactive in 1.5 s at the median on a 4x slower CPU).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LABELS = fileURLToPath(new URL("../../../packages/labels/vi/", import.meta.url));
/** Gzip bytes of the scripts and styles Home loads before it can be used. */
const FIRST_LOAD_BUDGET = 160 * 1024;

let outDir = "";
const modules = new Set<string>();
let code = "";
let html = "";

function recordModules(): Plugin {
  return {
    name: "record-modules",
    moduleParsed(info) {
      modules.add(info.id.replace(/\\/g, "/"));
    },
  };
}

const decode = (text: string): string => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "web-bundle-"));
  // Vitest runs with NODE_ENV=test; the scan reads the production build the server serves.
  await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), mode: "production", define: { "process.env.NODE_ENV": JSON.stringify("production") }, logLevel: "silent", plugins: [recordModules()], build: { outDir, emptyOutDir: true } });
  const assets = join(outDir, "assets");
  code = readdirSync(assets)
    .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
    .map((f) => decode(readFileSync(join(assets, f), "utf8")))
    .join("\n");
  html = readFileSync(join(outDir, "index.html"), "utf8");
}, 120_000);

afterAll(() => {
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
});

function labelValues(): Set<string> {
  const values = new Set<string>();
  for (const file of readdirSync(LABELS).filter((f) => f.endsWith(".json"))) {
    for (const value of Object.values(JSON.parse(readFileSync(join(LABELS, file), "utf8")) as Record<string, string>)) values.add(value);
  }
  return values;
}

/** Letters only Vietnamese uses (see apps/admin/tests/bundle-scan.test.ts). */
const VIETNAMESE_ONLY = /[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/g;

function strayVietnamese(text: string, labels: ReadonlySet<string>): string[] {
  const covered = new Uint8Array(text.length);
  for (const value of labels) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) covered.fill(1, at, at + value.length);
  }
  return [...text.matchAll(VIETNAMESE_ONLY)].filter((m) => covered[m.index] !== 1).map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30));
}

describe("Story 7.1 AC5: the built website holds no secret, no Vietnamese outside the label files, no packages/money", () => {
  it("contains no secret, token name or private key", () => {
    expect(code.length).toBeGreaterThan(10_000);
    for (const pattern of [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /INTERNAL_TOKEN/, /ASSISTANT_TOKEN/, /BRIDGE_TOKEN/, /FINGERPRINT_KEY/, /ACCESS_AUDIENCE/, /ACCESSTRADE_API_KEY/, /TELEGRAM_BOT_TOKEN/, /process\.env\.[A-Z]/, /Cf-Access-Jwt-Assertion/i, /\b[A-Fa-f0-9]{64}\b/]) {
      expect([pattern.source, pattern.test(code)]).toEqual([pattern.source, false]);
    }
  });

  it("has Vietnamese text only from the imported label files", () => {
    const labels = labelValues();
    expect(strayVietnamese(code, labels)).toEqual([]);
    expect([...code.matchAll(VIETNAMESE_ONLY)].length).toBeGreaterThan(50);
    expect(strayVietnamese(`${code} "\u1EE3\u1EE3\u1EE3"`, labels)).toHaveLength(3);
  });

  it("imports nothing from packages/money and nothing of the admin desk", () => {
    expect([...modules].some((id) => id.includes("/packages/ui/"))).toBe(true);
    expect([...modules].filter((id) => id.includes("/packages/money/") || id.includes("@cashback/money") || id.includes("/apps/admin/"))).toEqual([]);
  });
});

describe("Story 7.1 AC3: Home's first load stays within the size measured on 4G", () => {
  it("keeps the scripts and styles Home loads first under 160 KB gzipped, with the other pages split off", () => {
    const first = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1] ?? "");
    const bytes = first.reduce((sum, path) => sum + gzipSync(readFileSync(join(outDir, path))).length, 0);
    expect(first.some((p) => p.endsWith(".css"))).toBe(true);
    expect(bytes).toBeLessThan(FIRST_LOAD_BUDGET);
    expect(first.some((p) => /sign-in|my-money|guide|account-sheet/.test(p))).toBe(false);
  });
});
