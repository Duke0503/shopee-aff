/**
 * `pnpm cutover:step <step> ...`: the server-side steps the cutover scripts in
 * ops/windows/cutover/ call (Stories 8.7, 8.8; cutover-steps.ts, cutover-ledger-steps.ts). Each
 * prints one JSON line with counts, key names, codes, paths and hashes only; exit 0 on success, 1
 * when a check fails, 2 on a usage error.
 *
 *   preflight      --live-env <file> [--accept-gaps K1,K2] [--main-ref <ref>]
 *   builds
 *   backup         <live-db> <out-dir> [--encrypt-env prod]
 *   gate           <live-copy> <new-ledger>
 *   audit          <live-copy> <new-ledger> --out <dir>
 *   carry-over     --live-env <file> --prod-env <file> [--set KEY=VALUE ...] [--check]
 *   flags          <ledger>
 *   go-live        <ledger>
 *   smoke          <ledger> --local <url> [--host <host>] [--localhost] [--public <url>] [--sample <n>]
 *   rehearsal-env  --home <dir> --work <dir> --live-ledger <file> [--port <n>]
 *   install-ledger <new-ledger> --env <dev|prod>
 *   ledger-path    --env <dev|prod>
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { ENVIRONMENTS, type Environment } from "../platform/config/env.config";
import { auditStep, flagsStep, goLiveStep, installLedgerStep, ledgerPathOf, ledgerPathStep } from "./cutover-ledger-steps";
import { backupStep, buildsStep, parseWhole, carryOverStep, gateStep, preflightStep, rehearsalEnvStep, smokeStep, type StepAnswer } from "./cutover-steps";
import type { SmokeTarget } from "./smoke-check";

const OPTIONS = {
  "live-env": { type: "string" },
  "prod-env": { type: "string" },
  "accept-gaps": { type: "string" },
  "main-ref": { type: "string" },
  "encrypt-env": { type: "string" },
  "live-ledger": { type: "string" },
  set: { type: "string", multiple: true },
  check: { type: "boolean" },
  local: { type: "string" },
  host: { type: "string" },
  localhost: { type: "boolean" },
  public: { type: "string" },
  sample: { type: "string" },
  home: { type: "string" },
  work: { type: "string" },
  port: { type: "string" },
  env: { type: "string" },
  out: { type: "string" },
} as const;

class UsageError extends Error {}

const need = (value: string | undefined, what: string): string => {
  if (value === undefined || value === "") throw new UsageError(`give ${what}`);
  return value;
};

function wholeOption(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const whole = parseWhole(value, min, max);
  if (whole === null) throw new UsageError(`${name} must be a whole number from ${min} to ${max}`);
  return whole;
}

const envOf = (value: string | undefined): Environment => {
  if (!(ENVIRONMENTS as readonly (string | undefined)[]).includes(value)) throw new UsageError("give --env dev|prod");
  return value as Environment;
};

function fixedOf(pairs: readonly string[] | undefined): Record<string, string> {
  const fixed: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new UsageError("--set takes KEY=VALUE");
    fixed[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return fixed;
}

function smokeTargets(local: string, host: string | undefined, localhost: boolean, publicUrl: string | undefined): SmokeTarget[] {
  const base = new URL(local);
  const targets: SmokeTarget[] = [{ name: "local", base: local, ...(host ? { host } : {}) }];
  if (localhost) {
    targets.push({ name: "localhost", base: `http://localhost:${base.port || "80"}`, ...(host ? { host } : {}) });
    targets.push({ name: "ipv6", base: `http://[::1]:${base.port || "80"}`, ...(host ? { host } : {}) });
  }
  if (publicUrl) targets.push({ name: "public", base: publicUrl });
  return targets;
}

async function run(argv: readonly string[]): Promise<StepAnswer> {
  const { values: v, positionals } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: true });
  const [step, first, second] = positionals;
  switch (step) {
    case "preflight":
      return preflightStep(resolve(need(v["live-env"], "--live-env")), (v["accept-gaps"] ?? "").split(",").map((k) => k.trim()).filter((k) => k !== ""), v["main-ref"]);
    case "builds":
      return buildsStep();
    case "backup":
      return backupStep(resolve(need(first, "<live-db>")), resolve(need(second, "<out-dir>")), v["encrypt-env"] === undefined ? null : envOf(v["encrypt-env"]));
    case "gate":
      return gateStep(resolve(need(first, "<live-copy>")), resolve(need(second, "<new-ledger>")));
    case "audit":
      return auditStep(resolve(need(first, "<live-copy>")), resolve(need(second, "<new-ledger>")), resolve(need(v.out, "--out")));
    case "carry-over":
      return carryOverStep(resolve(need(v["live-env"], "--live-env")), resolve(need(v["prod-env"], "--prod-env")), fixedOf(v.set), v.check === true);
    case "flags":
      return flagsStep(resolve(need(first, "<ledger>")));
    case "go-live":
      return goLiveStep(resolve(need(first, "<ledger>")));
    case "smoke":
      return smokeStep(resolve(need(first, "<ledger>")), smokeTargets(need(v.local, "--local"), v.host, v.localhost === true, v.public), wholeOption(v.sample, "--sample", 20, 1, 1000));
    case "rehearsal-env":
      return rehearsalEnvStep(resolve(need(v.home, "--home")), resolve(need(v.work, "--work")), wholeOption(v.port, "--port", 9180, 1024, 65_534), need(v["live-ledger"], "--live-ledger"));
    case "install-ledger":
      return installLedgerStep(resolve(need(first, "<new-ledger>")), ledgerPathOf(envOf(v.env)));
    case "ledger-path":
      return ledgerPathStep(envOf(v.env));
    default:
      throw new UsageError("steps: preflight, builds, backup, gate, audit, carry-over, flags, go-live, smoke, rehearsal-env, install-ledger, ledger-path");
  }
}

let answer: StepAnswer;
try {
  answer = await run(process.argv.slice(2).filter((arg) => arg !== "--"));
} catch (error) {
  const code = (error as { code?: unknown }).code;
  const usage = error instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS"));
  // A message names paths, keys and codes only: no step reads a secret into an error.
  answer = { line: { ok: false, reason: usage ? "usage" : typeof code === "string" ? code : "failed", error: error instanceof Error ? error.message : String(error) }, code: usage ? 2 : 1 };
}
process.stdout.write(`${JSON.stringify(answer.line)}\n`);
process.exitCode = answer.code;
