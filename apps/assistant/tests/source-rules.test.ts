/**
 * Story 6.1 AC4: the assistant's source opens no database, binds no port and carries no
 * Vietnamese (or any non-ASCII) text; customer text lives only in packages/labels/vi/messages.json.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? tsFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []));
}

const SOURCES = tsFiles(join(APP, "src")).map((path) => ({ path, text: readFileSync(path, "utf8") }));
const ALL_TS = [...SOURCES, ...tsFiles(join(APP, "tests")).map((path) => ({ path, text: readFileSync(path, "utf8") }))];

const DATABASE = [/node:sqlite/, /better-sqlite3/, /drizzle-orm/, /\bsqlite\b/i, /\.db["'`]/, /\.sqlite["'`]/];
const LISTENER = [/node:(http|https|http2|net|dgram|tls)\b/, /from\s+["'](http|https|net|dgram|tls)["']/, /\.listen\s*\(/, /createServer\s*\(/, /\bfastify\b/i, /\bexpress\b/, /\bWebSocketServer\b/];

const hits = (patterns: readonly RegExp[]) => SOURCES.filter((s) => patterns.some((p) => p.test(s.text))).map((s) => s.path);

describe("Story 6.1: the assistant source", () => {
  it("AC4: no source file opens a database file or imports a database driver", () => {
    expect(SOURCES.length).toBeGreaterThan(5);
    expect(hits(DATABASE)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /sqlite|drizzle|fastify|express|\bws\b/.test(d))).toEqual([]);
  });

  it("AC4: no source file binds a port or serves a listener", () => {
    expect(hits(LISTENER)).toEqual([]);
  });

  it("AC4: no .ts file of the assistant contains a Vietnamese literal (or any character outside ASCII)", () => {
    expect(ALL_TS.filter((s) => /[^\t\n\r\x20-\x7e]/.test(s.text)).map((s) => s.path)).toEqual([]);
  });

  it("AC4: customer text is read from packages/labels/vi/messages.json, never from resources/", () => {
    expect(SOURCES.filter((s) => /resources\/|messages\.vi\.json/.test(s.text.replace(/^\s*(\*|\/\/).*$/gm, ""))).map((s) => s.path)).toEqual([]);
    expect(SOURCES.some((s) => s.text.includes("@cashback/labels/vi/messages.json"))).toBe(true);
  });
});
