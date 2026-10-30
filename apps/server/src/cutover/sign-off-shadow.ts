/**
 * `pnpm --filter @cashback/server shadow:sign-off --out <dir> --name "<owner>"`: records the
 * owner's sign-off of the shadow report in `<dir>` (Story 2.9): the name, the time and the
 * checksums of both report files, in `shadow-sign-off.json`, once. Prints one JSON line: exit 0
 * on success, 1 when refused, 2 on a usage error.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { systemClock } from "@cashback/core";

import { signShadowReport } from "./shadow-run";

function run(args: string[]): { line: Record<string, unknown>; code: number } {
  let out: string | undefined;
  let name: string | undefined;
  try {
    ({ out, name } = parseArgs({ args, options: { out: { type: "string" }, name: { type: "string" } }, strict: true }).values);
  } catch {
    out = undefined;
  }
  if (!out || name === undefined) return { line: { ok: false, reason: "usage", error: 'usage: shadow:sign-off --out <dir> --name "<owner>"' }, code: 2 };
  try {
    const signOff = signShadowReport(resolve(out), name, systemClock);
    return { line: { ok: true, ...signOff }, code: 0 };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { line: { ok: false, reason: typeof code === "string" ? code : "failed", error: error instanceof Error ? error.message : String(error) }, code: 1 };
  }
}

const { line, code } = run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(line)}\n`);
process.exitCode = code;
