// @vitest-environment node
/**
 * Story 4.4 AC5: the built admin bundle is scanned for secrets, for Vietnamese text that does not
 * come from the imported label files, and for any module of packages/money. The build runs here
 * with the real Vite config into a temporary folder, with a plugin that records every module id.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LABELS = fileURLToPath(new URL("../../../packages/labels/vi/", import.meta.url));

let outDir = "";
const modules = new Set<string>();
let code = "";

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
  outDir = mkdtempSync(join(tmpdir(), "admin-bundle-"));
  await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "silent", plugins: [recordModules()], build: { outDir, emptyOutDir: true } });
  const assets = join(outDir, "assets");
  code = readdirSync(assets)
    .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
    .map((f) => decode(readFileSync(join(assets, f), "utf8")))
    .join("\n");
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

/**
 * Letters only Vietnamese uses (a with breve, d with stroke, o and u with horn, and the tone-marked vowels of Latin Extended
 * Additional). Libraries carry Latin-1 ranges in their own regular expressions; these letters
 * appear in the bundle only through text.
 */
const VIETNAMESE_ONLY = /[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/g;

/** Each Vietnamese letter that is not inside one of the label values, with its context. */
function strayVietnamese(text: string, labels: ReadonlySet<string>): string[] {
  const covered = new Uint8Array(text.length);
  for (const value of labels) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) covered.fill(1, at, at + value.length);
  }
  return [...text.matchAll(VIETNAMESE_ONLY)].filter((m) => covered[m.index] !== 1).map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30));
}

describe("Story 4.4 AC5: the built bundle holds no secret, no Vietnamese outside the label files, no packages/money", () => {
  it("contains no secret, token name or private key", () => {
    expect(code.length).toBeGreaterThan(10_000);
    for (const pattern of [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /INTERNAL_TOKEN/, /ACCESS_AUDIENCE/, /ACCESSTRADE_API_KEY/, /process\.env\.[A-Z]/, /Cf-Access-Jwt-Assertion/i, /\b[A-Fa-f0-9]{64}\b/]) {
      expect([pattern.source, pattern.test(code)]).toEqual([pattern.source, false]);
    }
  });

  it("has Vietnamese text only from the imported label files", () => {
    const labels = labelValues();
    expect(strayVietnamese(code, labels)).toEqual([]);
    expect([...code.matchAll(VIETNAMESE_ONLY)].length).toBeGreaterThan(50);
    expect(strayVietnamese(`${code} "\u1ee3\u1ee3\u1ee3"`, labels)).toHaveLength(3);
  });

  it("imports nothing from packages/money", () => {
    expect([...modules].some((id) => id.includes("/packages/ui/"))).toBe(true);
    expect([...modules].filter((id) => id.includes("/packages/money/") || id.includes("@cashback/money"))).toEqual([]);
  });
});
