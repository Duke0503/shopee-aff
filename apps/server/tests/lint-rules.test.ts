import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

describe("code.md guardrails in lint", () => {
  it("Story 1.5 AC5: rejects a process.env read outside platform/config", async () => {
    const code = 'export const token = process.env["INTERNAL_TOKEN"];\n';
    expect(await ruleIds(code, "apps/server/src/modules/orders/token.ts")).toContain("no-restricted-properties");
    expect(await ruleIds(code, "packages/core/src/text/token.ts")).toContain("no-restricted-properties");
    expect(await ruleIds(code, "apps/server/src/platform/config/token.config.ts")).toEqual([]);
  }, 30_000);

  it("Story 1.6 AC2: rejects an async callback passed to tx", async () => {
    const asyncArrow = "declare const ledger: { tx<T>(fn: () => T): T };\nexport const r = ledger.tx(async () => 1);\n";
    const asyncFunction = "declare function tx<T>(fn: () => T): T;\nexport const r = tx(async function () { return 1; });\n";
    const sync = "declare const ledger: { tx<T>(fn: () => T): T };\nexport const r = ledger.tx(() => 1);\n";
    expect(await ruleIds(asyncArrow, "apps/server/src/modules/orders/sample.command.ts")).toContain("no-restricted-syntax");
    expect(await ruleIds(asyncFunction, "apps/server/src/modules/orders/sample.command.ts")).toContain("no-restricted-syntax");
    expect(await ruleIds(sync, "apps/server/src/modules/orders/sample.command.ts")).toEqual([]);
  }, 30_000);
});
