/**
 * The admin desk under test (Story 4.2): a migrated ledger with staff members whose passwords are
 * generated per run, a Cloudflare Access team whose RSA key pair is generated per run, a signer
 * for its JWTs, and the public listener with the staff routes on the admin host.
 */
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { parseInstant, toMs, type Clock } from "@cashback/core";

import { adminDesk } from "../../src/admin/admin-desk";
import { hashPassword } from "../../src/modules/identity/index";
import { customerProofRoutes, fileProofStore, proofFilesDir, type ProofStore } from "../../src/modules/payouts/index";
import { receiptPageRoutes } from "../../src/pages/receipt.page";
import type { StaffAccessConfig } from "../../src/platform/config/env.config";
import type { Ledger } from "../../src/platform/db/ledger";
import type { AccessKeySource } from "../../src/platform/http/access-jwt.guard";
import { buildServers, type Servers } from "../../src/platform/http/servers";
import { tempDir } from "./live-fixture";
import type { StaffRoutes } from "../../src/platform/http/staff-routes";

export const ADMIN_HOST = "admin.hoantiendp.com";
export const PUBLIC_HOST = "hoantiendp.com";
export const ACCESS: StaffAccessConfig = { adminHost: ADMIN_HOST, accessTeamDomain: "cashback-test.cloudflareaccess.com", accessAudience: randomBytes(32).toString("hex") };
export const ORIGIN = `https://${ADMIN_HOST}`;

const teamKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
/** Another key pair: a token it signs is not one Access issued. */
export const STRANGER_KEY: KeyObject = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const KID = "team-key-1";

export const TEAM_KEYS: AccessKeySource = { keyFor: async (kid) => (kid === KID ? teamKeys.publicKey : null) };

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

export interface JwtOptions {
  aud?: string | string[];
  iss?: string;
  /** Seconds from the clock's now. */
  expiresIn?: number;
  key?: KeyObject;
  alg?: string;
  kid?: string;
  /** The Access identity (subject id); one fixed identity by default. */
  sub?: string;
}

export const ACCESS_SUBJECT = "7b3c1a52-0d4e-4f1a-9c3b-1f2e3d4c5b6a";

/** A Cloudflare Access application token as the edge would send it, valid unless options say otherwise. */
export function accessJwt(clock: Clock, options: JwtOptions = {}): string {
  const now = Math.floor(toMs(parseInstant(clock.now())) / 1000);
  const header = b64url({ alg: options.alg ?? "RS256", kid: options.kid ?? KID, typ: "JWT" });
  const claims = b64url({ aud: options.aud ?? [ACCESS.accessAudience], iss: options.iss ?? `https://${ACCESS.accessTeamDomain}`, iat: now, nbf: now, exp: now + (options.expiresIn ?? 600), sub: options.sub ?? ACCESS_SUBJECT, email: "staff@example.test", type: "app" });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), options.key ?? teamKeys.privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

/** A password generated for this run; never a real one. */
export const generatedPassword = (): string => randomBytes(18).toString("base64url");

export async function addStaff(ledger: Ledger, staffId: string, role: "ADMIN" | "EMPLOYEE", password: string, options: { root?: boolean; status?: "ACTIVE" | "DISABLED" } = {}): Promise<void> {
  const hash = await hashPassword(password);
  ledger.sqlite
    .prepare("INSERT INTO staff (staff_id, username, role, status, is_root, password_hash, password_set_at, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')")
    .run(staffId, staffId, role, options.status ?? "ACTIVE", options.root ? 1 : 0, hash);
}

/** A proof store in a fresh temporary directory, one per desk under test. */
export const testProofStore = (): ProofStore => fileProofStore(proofFilesDir(tempDir("cashback-proofs-")));

export function deskServers(ledger: Ledger, clock: Clock, extra: readonly StaffRoutes[] = [], proofs: ProofStore = testProofStore()): Servers {
  const desk = adminDesk({ access: ACCESS, ledger, clock, production: false, keys: TEAM_KEYS, proofs });
  const pages = [receiptPageRoutes({ ledger, clock }), customerProofRoutes({ ledger, clock, proofs })];
  return buildServers({ clock, internalToken: randomBytes(24).toString("hex"), public: pages, staff: { gate: desk.gate, routes: [...desk.routes, ...extra] } });
}

/** The value of one cookie from a response's Set-Cookie header. */
export function setCookieValue(header: string | string[] | undefined, name: string): string | null {
  const all = Array.isArray(header) ? header : header === undefined ? [] : [header];
  const found = all.find((c) => c.startsWith(`${name}=`));
  return found === undefined ? null : (found.slice(name.length + 1).split(";")[0] ?? null);
}
