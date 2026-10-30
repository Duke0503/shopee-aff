/**
 * Story 1.10: the seven module skeleton and the boundaries dependency-cruiser enforces.
 * Violation cases run the real CLI with the real `.dependency-cruiser.cjs` over a small
 * sandbox tree laid out like the repository, so a rule that stops matching fails here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG = join(ROOT, ".dependency-cruiser.cjs");
const CLI = join(ROOT, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs");
const SPINE = join(ROOT, "_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md");
const MODULES = ["identity", "linking", "orders", "payouts", "campaigns", "messaging", "operations"];

interface Violation {
  from: string;
  to: string;
  rule: { name: string };
}

function readEdges(): Record<string, string[]> {
  const { $comment: _comment, ...edges } = JSON.parse(readFileSync(join(ROOT, "apps/server/src/modules/module-edges.json"), "utf8")) as Record<string, unknown>;
  return edges as Record<string, string[]>;
}

/** Module-to-module arrows of the dependency diagram in the spine. */
function spineEdges(): Record<string, string[]> {
  const text = readFileSync(SPINE, "utf8");
  const diagram = /```mermaid\n(flowchart TB[\s\S]*?)```/.exec(text)?.[1] ?? "";
  const edges: Record<string, string[]> = Object.fromEntries(MODULES.map((m) => [m, []]));
  for (const match of diagram.matchAll(/^\s*(\w+)\s*-->\s*(\w+)\s*$/gm)) {
    const [, from = "", to = ""] = match;
    if (MODULES.includes(from) && MODULES.includes(to)) edges[from]?.push(to);
  }
  return Object.fromEntries(Object.entries(edges).map(([m, to]) => [m, to.sort()]));
}

/** Runs the depcruise CLI as CI does; the JSON report carries the violations. */
function cruise(cwd: string, targets: string[]): { violations: Violation[] } {
  const args = [CLI, ...targets, "--config", CONFIG, "--output-type", "json"];
  // The JSON report of the whole repository is past the 1 MB default buffer.
  const out = execFileSync(process.execPath, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return { violations: (JSON.parse(out) as { summary: { violations: Violation[] } }).summary.violations };
}

/** The exit code of the plain CLI run, as `pnpm depcruise` sees it. */
function cruiseExitCode(cwd: string, targets: string[]): number {
  try {
    execFileSync(process.execPath, [CLI, ...targets, "--config", CONFIG], { cwd, stdio: "ignore" });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

/** A sandbox laid out like the repository, with the server's node_modules linked in. */
function sandbox(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cashback-depcruise-"));
  writeFileSync(join(dir, "tsconfig.base.json"), JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler" } }));
  symlinkSync(join(ROOT, "apps", "server", "node_modules"), join(dir, "node_modules"), "junction");
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const M = "apps/server/src/modules";
const SKELETON: Record<string, string> = {
  [`${M}/orders/index.ts`]: "export const orders = 1;\n",
  [`${M}/linking/index.ts`]: "export const linking = 1;\n",
  [`${M}/payouts/index.ts`]: "export const payouts = 1;\n",
  [`${M}/payouts/payout.repository.ts`]: "export const payoutRows = 1;\n",
  [`${M}/identity/index.ts`]: "export const identity = 1;\n",
  "packages/money/src/index.ts": "export const money = 1;\n",
};

const ruleNames = (violations: Violation[]) => [...new Set(violations.map((v) => v.rule.name))].sort();

describe("Story 1.10: seven module skeleton", () => {
  it("has the seven modules, each with domain/, http/ and index.ts", () => {
    for (const module of MODULES) {
      for (const part of ["domain", "http", "index.ts"]) {
        expect(existsSync(join(ROOT, M, module, part)), `${module}/${part}`).toBe(true);
      }
    }
  });

  it("declares the platform ports outbox.enqueue, audit.record and alert as types", () => {
    const ports = join(ROOT, "apps/server/src/platform/ports");
    expect(readFileSync(join(ports, "outbox.port.ts"), "utf8")).toMatch(/enqueue\(/);
    expect(readFileSync(join(ports, "audit.port.ts"), "utf8")).toMatch(/record\(/);
    expect(readFileSync(join(ports, "alert.port.ts"), "utf8")).toMatch(/alert\(/);
  });
});

describe("Story 1.10: boundaries enforced by dependency-cruiser", () => {
  it("AC1: the rule set lists exactly the module edges of the spine diagram", () => {
    expect(readEdges()).toEqual(spineEdges());
    expect(Object.keys(readEdges()).sort()).toEqual([...MODULES].sort());
  });

  it("AC1: pnpm depcruise passes on the repository", () => {
    expect(cruise(ROOT, ["apps", "packages"]).violations).toEqual([]);
    expect(cruiseExitCode(ROOT, ["apps", "packages"])).toBe(0);
  }, 60_000);

  it("AC1: an import against an edge of the diagram fails (identity may import no module)", () => {
    const dir = sandbox({ ...SKELETON, [`${M}/identity/customer.query.ts`]: 'export { orders } from "../orders/index";\n' });
    const { violations } = cruise(dir, ["apps"]);
    expect(violations).toContainEqual(expect.objectContaining({ from: `${M}/identity/customer.query.ts`, to: `${M}/orders/index.ts`, rule: expect.objectContaining({ name: "module-edges-identity" }) }));
  }, 60_000);

  it("AC2: an import from orders into payouts internals fails, naming both files", () => {
    const dir = sandbox({ ...SKELETON, [`${M}/orders/sample.command.ts`]: 'export { payoutRows } from "../payouts/payout.repository";\n' });
    const { violations } = cruise(dir, ["apps"]);
    expect(cruiseExitCode(dir, ["apps"])).not.toBe(0);
    expect(violations).toContainEqual(expect.objectContaining({ from: `${M}/orders/sample.command.ts`, to: `${M}/payouts/payout.repository.ts`, rule: expect.objectContaining({ name: "server-module-walls" }) }));
  }, 60_000);

  it("AC3: a domain/ file importing Fastify, Drizzle or another module fails", () => {
    const dir = sandbox({
      ...SKELETON,
      [`${M}/orders/domain/uses-fastify.ts`]: 'import type { FastifyInstance } from "fastify";\nexport type F = FastifyInstance;\n',
      [`${M}/orders/domain/uses-drizzle.ts`]: 'import { sql } from "drizzle-orm";\nexport const s = sql;\n',
      [`${M}/orders/domain/uses-module.ts`]: 'export { linking } from "../../linking/index";\n',
    });
    const { violations } = cruise(dir, ["apps"]);
    const domain = violations.filter((v) => v.rule.name === "domain-stays-pure").map((v) => v.from).sort();
    expect(domain).toEqual([`${M}/orders/domain/uses-drizzle.ts`, `${M}/orders/domain/uses-fastify.ts`, `${M}/orders/domain/uses-module.ts`]);
  }, 60_000);

  it("AC4: apps/web or apps/admin importing packages/money fails", () => {
    const dir = sandbox({
      ...SKELETON,
      "apps/web/src/main.ts": 'export { money } from "../../../packages/money/src/index";\n',
      "apps/admin/src/main.ts": 'export { money } from "../../../packages/money/src/index";\n',
    });
    const { violations } = cruise(dir, ["apps"]);
    const money = violations.filter((v) => v.rule.name === "frontends-never-import-money").map((v) => v.from).sort();
    expect(money).toEqual(["apps/admin/src/main.ts", "apps/web/src/main.ts"]);
  }, 60_000);

  it("http/ never touches its module's repository, platform never imports a module, core never imports Fastify", () => {
    const dir = sandbox({
      ...SKELETON,
      "packages/core/src/uses-fastify.ts": 'import type { FastifyInstance } from "fastify";\nexport type F = FastifyInstance;\n',
      [`${M}/payouts/http/payout.routes.ts`]: 'export { payoutRows } from "../payout.repository";\n',
      "apps/server/src/platform/db/uses-module.ts": 'export { orders } from "../../modules/orders/index";\n',
    });
    expect(ruleNames(cruise(dir, ["apps", "packages"]).violations)).toEqual(["http-calls-commands-and-queries", "platform-never-imports-a-module", "pure-packages"]);
  }, 60_000);

  it("a clean sandbox has no violations (the rules do not fire on allowed edges)", () => {
    const dir = sandbox({ ...SKELETON, [`${M}/orders/order.query.ts`]: 'export { linking } from "../linking/index";\nexport { identity } from "../identity/index";\n' });
    expect(cruise(dir, ["apps"]).violations).toEqual([]);
  }, 60_000);
});
