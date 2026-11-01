/**
 * The internal CLI (decision H8, Story 4.20): a small client of the admin commands on the internal
 * listener (admin-command.routes.ts), so the running server stays the one writer of the ledger.
 *
 *   staff-seed <seed.json> [--as <admin>]               create the root admin and the listed staff that do not exist yet
 *   staff-password <staffId> --as <admin>               set a new password; the member's sessions end
 *   staff-access <staffId> --as <admin> [--role R] [--status S]
 *   campaign-create <campaign.json> --as <admin> [--apply]   preview, and with --apply create
 *   customer-merge <merged> --into <survivor> --as <admin> [--apply]   preview the merge, and with --apply merge
 *   link-queue resume --as <admin>                       resume the Shopee link queue after the affiliate browser signed in again
 *   messaging-silent on|off --as <admin>                 turn the quiet mode of notifications on or off (Story 6.10)
 *
 * `--as` signs in as that admin (the password is asked, never an argument) and signs out at the
 * end. The first seed of an empty staff table needs no `--as`. Every new password is asked twice
 * and never printed: the prompt reads without echo on a terminal, or one line per answer from a
 * pipe. The answer is one JSON line on stdout with ids and counts only, whatever happens: a
 * server that cannot be reached, a cancelled or missing answer, an answer the contract does not
 * accept, or any other failure is a reason code, never a stack trace, a password or a token.
 * Exit 0 on success, 1 when refused or failed, 2 on a usage error.
 */
import {
  adminSignInResponseSchema,
  campaignInputSchema,
  campaignPreviewResponseSchema,
  customerMergedResponseSchema,
  customerMergePreviewSchema,
  LINK_QUEUE_RESUME_PATH,
  linkQueueResumedSchema,
  MESSAGING_SILENT_PATH,
  messagingSilentSetSchema,
  STAFF_TOKEN_HEADER,
  staffAccessResponseSchema,
  staffPasswordResponseSchema,
  staffPasswordSchema,
  staffSeedResponseSchema,
  staffSeedSchema,
  type CampaignPreviewResponse,
} from "@cashback/contracts";
import admin from "@cashback/labels/vi/admin.json" with { type: "json" };
import { ZodError } from "zod";

export interface CliAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface CliIo {
  call(method: "POST" | "DELETE", path: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<CliAnswer>;
  /** One answer typed without echo (or the next piped line). */
  secret(prompt: string): Promise<string>;
  readJson(path: string): unknown;
  print(line: Readonly<Record<string, unknown>>): void;
}

/** Why the terminal or the connection gave no answer; the entry point throws these. */
export type CliIoReason = "server_unreachable" | "cancelled" | "no_answer";

export class CliIoError extends Error {
  constructor(readonly reason: CliIoReason) {
    super(reason);
    this.name = "CliIoError";
  }
}

const UNREACHABLE = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

/** The reason code of a failure that is not a refusal; the error's text is never printed. */
function failureReason(error: unknown): string {
  if (error instanceof CliIoError) return error.reason;
  if (error instanceof ZodError || (error instanceof Error && error.name === "ZodError")) return "bad_response";
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (error instanceof TypeError && typeof code === "string" && UNREACHABLE.has(code)) return "server_unreachable";
  return "failed";
}

class CliRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(reason);
  }
}

interface Args {
  readonly command: string;
  readonly target: string;
  readonly flags: ReadonlyMap<string, string | true>;
}

const COMMANDS = ["staff-seed", "staff-password", "staff-access", "campaign-create", "customer-merge", "link-queue", "messaging-silent"];
export const CLI_USAGE = "usage: staff-seed <seed.json> [--as <admin>] | staff-password <staffId> --as <admin> | staff-access <staffId> --as <admin> [--role ADMIN|EMPLOYEE] [--status ACTIVE|DISABLED] | campaign-create <campaign.json> --as <admin> [--apply] | customer-merge <merged> --into <survivor> --as <admin> [--apply] | link-queue resume --as <admin> | messaging-silent on|off --as <admin>";

function parseArgs(argv: readonly string[]): Args | null {
  const [command, target, ...rest] = argv;
  if (command === undefined || !COMMANDS.includes(command) || target === undefined || target.startsWith("--")) return null;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i] ?? "";
    if (!flag.startsWith("--")) return null;
    const value = rest[i + 1];
    if (flag === "--apply") {
      flags.set(flag, true);
      continue;
    }
    if (value === undefined || value.startsWith("--")) return null;
    flags.set(flag, value);
    i++;
  }
  return { command, target, flags };
}

function refusalOf(answer: CliAnswer): CliRefusal {
  const error = (answer.body as { error?: { messageKey?: string; fields?: Record<string, string> } } | null)?.error;
  return new CliRefusal(error?.messageKey ?? `http_${answer.status}`, error?.fields ?? {});
}

async function ok(io: CliIo, method: "POST" | "DELETE", path: string, body: unknown, token: string | null): Promise<unknown> {
  const answer = await io.call(method, path, body, token === null ? {} : { [STAFF_TOKEN_HEADER]: token });
  if (answer.status !== 200) throw refusalOf(answer);
  return answer.body;
}

async function newPassword(io: CliIo, staffId: string): Promise<string> {
  const first = await io.secret(`New password for ${staffId} (at least 12 characters): `);
  if (!staffPasswordSchema.safeParse(first).success) throw new CliRefusal("password_too_short", { staffId });
  if ((await io.secret(`Type it again for ${staffId}: `)) !== first) throw new CliRefusal("passwords_differ", { staffId });
  return first;
}

async function signIn(io: CliIo, username: string | null): Promise<string | null> {
  if (username === null) return null;
  const password = await io.secret(`Password for ${username}: `);
  return adminSignInResponseSchema.parse(await ok(io, "POST", "/internal/admin/session", { username, password }, null)).token;
}

function parsedFile<T>(io: CliIo, path: string, parse: (value: unknown) => { success: true; data: T } | { success: false }): T {
  let value: unknown;
  try {
    value = io.readJson(path);
  } catch {
    throw new CliRefusal("invalid_file", { file: path });
  }
  const result = parse(value);
  if (!result.success) throw new CliRefusal("invalid_file", { file: path });
  return result.data;
}

async function staffSeed(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  const seed = parsedFile(io, args.target, (v) => staffSeedSchema.safeParse(v));
  const plan = staffSeedResponseSchema.parse(await ok(io, "POST", "/internal/admin/staff/seed/preview", { seed }, token));
  const passwords: Record<string, string> = {};
  for (const member of plan.create) passwords[member.staffId] = await newPassword(io, member.staffId);
  const done = staffSeedResponseSchema.parse(await ok(io, "POST", "/internal/admin/staff/seed", { seed, passwords }, token));
  return { created: done.create.map((m) => m.staffId), unchanged: done.unchanged, bootstrap: done.bootstrap };
}

async function staffPassword(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  const password = await newPassword(io, args.target);
  return staffPasswordResponseSchema.parse(await ok(io, "POST", `/internal/admin/staff/${encodeURIComponent(args.target)}/password`, { password }, token));
}

async function staffAccess(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  const role = args.flags.get("--role");
  const status = args.flags.get("--status");
  const body = { ...(typeof role === "string" ? { role } : {}), ...(typeof status === "string" ? { status } : {}) };
  return staffAccessResponseSchema.parse(await ok(io, "POST", `/internal/admin/staff/${encodeURIComponent(args.target)}/access`, body, token));
}

/** "until before 00:00 on 15/11", from the label file: the window end is exclusive (D22). */
export const endsBeforeText = (p: CampaignPreviewResponse): string => admin.campaign_ends_before.replace("{time}", p.endsBefore.time).replace("{date}", p.endsBefore.date);

async function campaignCreate(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  const campaign = parsedFile(io, args.target, (v) => campaignInputSchema.safeParse(v));
  const preview = campaignPreviewResponseSchema.parse(await ok(io, "POST", "/internal/admin/campaigns/preview", { campaign }, token));
  if (args.flags.get("--apply") !== true) return { applied: false, preview, endsBefore: endsBeforeText(preview) };
  const created = campaignPreviewResponseSchema.parse(await ok(io, "POST", "/internal/admin/campaigns", { campaign }, token));
  return { applied: true, preview: created, endsBefore: endsBeforeText(created) };
}

/** Story 4.19: the preview first, always; `--apply` merges and answers the survivor's balance read again. */
async function customerMerge(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  const survivor = args.flags.get("--into");
  if (typeof survivor !== "string") throw new CliRefusal("usage", { error: CLI_USAGE });
  const body = { merged: args.target, survivor };
  const preview = customerMergePreviewSchema.parse(await ok(io, "POST", "/internal/admin/customers/merge/preview", body, token));
  if (args.flags.get("--apply") !== true) return { applied: false, preview };
  const merged = customerMergedResponseSchema.parse(await ok(io, "POST", "/internal/admin/customers/merge", body, token));
  return { applied: true, preview, merged };
}

/** Story 5.5 AC4: the owner resumes a paused (or held) Shopee link queue. */
async function linkQueue(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  if (args.target !== "resume") throw new CliRefusal("usage", { error: CLI_USAGE });
  return linkQueueResumedSchema.parse(await ok(io, "POST", LINK_QUEUE_RESUME_PATH, {}, token));
}

/** Story 6.10 AC4: the owner turns the quiet mode on or off; the server audits it under the admin. */
async function messagingSilent(io: CliIo, args: Args, token: string | null): Promise<Record<string, unknown>> {
  if (args.target !== "on" && args.target !== "off") throw new CliRefusal("usage", { error: CLI_USAGE });
  return messagingSilentSetSchema.parse(await ok(io, "POST", MESSAGING_SILENT_PATH, { silent: args.target === "on" }, token));
}

const RUN: Record<string, (io: CliIo, args: Args, token: string | null) => Promise<Record<string, unknown>>> = {
  "staff-seed": staffSeed,
  "staff-password": staffPassword,
  "staff-access": staffAccess,
  "campaign-create": campaignCreate,
  "customer-merge": customerMerge,
  "link-queue": linkQueue,
  "messaging-silent": messagingSilent,
};

/** Runs one command; returns the exit code after printing its one JSON line. */
export async function runAdminCli(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv);
  const signer = args?.flags.get("--as");
  if (args === null || signer === true || (signer === undefined && args.command !== "staff-seed")) {
    io.print({ ok: false, reason: "usage", error: CLI_USAGE });
    return 2;
  }
  let token: string | null = null;
  try {
    token = await signIn(io, signer ?? null);
    const result = await (RUN[args.command] as (typeof RUN)[string])(io, args, token);
    io.print({ ok: true, command: args.command, ...result });
    return 0;
  } catch (error) {
    if (error instanceof CliRefusal) io.print({ ok: false, command: args.command, reason: error.reason, ...error.detail });
    else io.print({ ok: false, command: args.command, reason: failureReason(error) });
    return 1;
  } finally {
    if (token !== null) await io.call("DELETE", "/internal/admin/session", undefined, { [STAFF_TOKEN_HEADER]: token }).catch(() => undefined);
  }
}
