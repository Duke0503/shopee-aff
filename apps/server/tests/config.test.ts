import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { ConfigError, configFilePath, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { SERVER_DIR, sandbox, startServer } from "./helpers/server-process";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/[\\/]$/, "");

const TOKEN = "s".repeat(40);

describe("config (Story 1.5, AD-19)", () => {
  it("reads the per-environment file under ~/.config/cashback", () => {
    expect(configFilePath("prod", "/home/op")).toBe(join("/home/op", ".config", "cashback", "prod.env"));
  });

  it("applies the dev defaults and puts the data directory at <repository>/data/<env>", () => {
    const config = parseConfig("dev", { INTERNAL_TOKEN: TOKEN });
    expect(config).toMatchObject({ env: "dev", publicPort: 9080, internalPort: 9081, logLevel: "info" });
    expect(REPOSITORY_ROOT).toBe(ROOT);
    expect(config.dataDir).toBe(join(ROOT, "data", "dev"));
    expect(parseConfig("prod", { INTERNAL_TOKEN: TOKEN }).publicPort).toBe(8080);
  });

  it("Story 2.2 review item 10: FINGERPRINT_KEY and LIVE_LEDGER_PATH are read but left to the commands that need them", () => {
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN })).toMatchObject({ fingerprintKey: null, liveLedgerPath: null });
    // A short key does not stop the server: only the cutover import checks it (fingerprint_key_too_short).
    expect(parseConfig("prod", { INTERNAL_TOKEN: TOKEN, FINGERPRINT_KEY: "short", LIVE_LEDGER_PATH: "relative.sqlite" })).toMatchObject({ fingerprintKey: "short", liveLedgerPath: "relative.sqlite" });
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, FINGERPRINT_KEY: "", LIVE_LEDGER_PATH: "" })).toMatchObject({ fingerprintKey: null, liveLedgerPath: null });
  });

  it("review item 2: resolves the same data directory whatever the start directory", () => {
    const configModule = pathToFileURL(join(SERVER_DIR, "src", "platform", "config", "env.config.ts")).href;
    const script = `const m = await import(${JSON.stringify(configModule)}); console.log(m.parseConfig("dev", { INTERNAL_TOKEN: "${TOKEN}" }).dataDir);`;
    const tsx = import.meta.resolve("tsx");
    const run = (cwd: string): string =>
      execFileSync(process.execPath, ["--import", tsx, "--input-type=module", "-e", script], { cwd, encoding: "utf8" }).trim();
    const fromServer = run(SERVER_DIR);
    const fromElsewhere = run(mkdtempSync(join(tmpdir(), "cashback-cwd-")));
    expect(fromServer).toBe(join(ROOT, "data", "dev"));
    expect(fromElsewhere).toBe(fromServer);
  }, 30_000);

  it("review item 2: the default data directory is ignored by git", () => {
    const ignored = execFileSync("git", ["check-ignore", "data/dev/server.lock", "data/prod/ledger.sqlite-wal"], { cwd: ROOT, encoding: "utf8" });
    expect(ignored.trim().split(/\r?\n/)).toEqual(["data/dev/server.lock", "data/prod/ledger.sqlite-wal"]);
  });

  it("requires DATA_DIR to be absolute, so it never depends on the start directory", () => {
    expect(() => parseConfig("prod", { INTERNAL_TOKEN: TOKEN, DATA_DIR: "data/prod" })).toThrow("config: missing or invalid DATA_DIR");
    expect(parseConfig("prod", { INTERNAL_TOKEN: TOKEN, DATA_DIR: join(tmpdir(), "cashback-prod") }).dataDir).toBe(join(tmpdir(), "cashback-prod"));
  });

  it("names every missing or invalid key and no value", () => {
    const secret = "too-short-secret-value";
    const error = (() => {
      try {
        parseConfig("dev", { INTERNAL_TOKEN: secret, PUBLIC_PORT: "99999" });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toBe("config: missing or invalid INTERNAL_TOKEN, PUBLIC_PORT");
    expect((error as Error).message).not.toContain(secret);
  });

  it("AC1: the server exits with the name of the missing key and prints no secret value", async () => {
    const otherSecret = "telegram-secret-0123456789abcdef";
    const server = startServer(sandbox([`TELEGRAM_TOKEN=${otherSecret}`, "PUBLIC_PORT=9180"]));
    const code = await server.exited;
    expect(code).toBe(1);
    expect(server.output()).toContain("INTERNAL_TOKEN");
    expect(server.output()).not.toContain(otherSecret);
  }, 30_000);

  it("AC1: an invalid secret is named, never echoed", async () => {
    const shortToken = "short-internal-token-value";
    const server = startServer(sandbox([`INTERNAL_TOKEN=${shortToken}`]));
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain("INTERNAL_TOKEN");
    expect(server.output()).not.toContain(shortToken);
  }, 30_000);
});
