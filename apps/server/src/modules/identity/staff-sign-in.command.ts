/**
 * Staff sign-in on the admin host (AD-18, D48, FR-24, INV-8, INV-11; Story 4.2). The answer never
 * tells which names exist: every attempt, for a real, unknown or disabled name, goes through the
 * same steps. The doubling delay is kept per (submitted name, Cloudflare Access identity), so a
 * guesser waits whatever name they try, and one Access identity's failures never delay another
 * identity's sign-in to the same account. The password is checked with argon2id before the
 * transaction, never inside it, against a dummy hash when there is no active account, so the
 * timing matches too. Then one transaction re-checks the wait and either counts the failure or
 * opens a 12-hour staff session, each with its audit entry. Only the SHA-256 of the session
 * token is stored. A failed attempt is audited under the sign-in system actor, never as the
 * staff member it targeted, with the target and the Access identity as ids.
 */
import { toMs, instantFromMs, type Clock } from "@cashback/core";
import { and, eq } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Actor, AuditPort } from "../../platform/ports/audit.port";
import type { StaffPrincipal } from "../../platform/ports/staff-session.port";
import { signInDelayMs } from "./domain/sign-in-delay";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password-hash";
import { staff, staffSignInThrottles, type StaffRow } from "./schema";
import { openSession, STAFF_SESSION_MS, type OpenedSession } from "./session.command";

export interface StaffSignInInput {
  readonly username: string;
  readonly password: string;
  /** The Cloudflare Access subject id of the verified JWT on this request. */
  readonly accessSubject: string;
}

export type StaffSignIn =
  | { readonly outcome: "signed_in"; readonly staff: StaffPrincipal; readonly session: OpenedSession }
  | { readonly outcome: "refused"; readonly reason: "bad_credentials" | "waiting"; readonly retryAt?: string };

export interface StaffSignInDeps {
  readonly clock: Clock;
  /** The audit port bound to the sign-in's own transaction handle. */
  readonly auditFor: (db: LedgerDb) => AuditPort;
  /** The password check; argon2id `verifyPassword` unless a test watches it. */
  readonly verify?: (hash: string, password: string) => Promise<boolean>;
}

/** The actor of a failed sign-in: nobody has proved who they are yet. */
export const STAFF_SIGN_IN_ACTOR: Actor = { kind: "system", id: "staff-sign-in" };
/** The entity of a failed attempt on a name no staff member has. */
export const UNKNOWN_STAFF = "unknown";
const MAX_USERNAME = 64;

/** A valid argon2id hash of no password anyone has; verifying against it costs the same as a real one. */
export const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2lnbi1pbi1kdW1teS1zYWx0$5rnTNcg0vmr6C5hVfzJs1x3QTv1Ku8DAfQXT9+lhVFY";

type Pair = { readonly username: string; readonly accessSubject: string };
type Throttle = typeof staffSignInThrottles.$inferSelect;

const staffNamed = (db: LedgerDb, username: string): StaffRow | null => db.select().from(staff).where(eq(staff.username, username)).get() ?? null;
const activeStaff = (db: LedgerDb, username: string): StaffRow | null => {
  const row = staffNamed(db, username);
  return row !== null && row.status === "ACTIVE" ? row : null;
};

const throttleOf = (db: LedgerDb, pair: Pair): Throttle | null =>
  db
    .select()
    .from(staffSignInThrottles)
    .where(and(eq(staffSignInThrottles.username, pair.username), eq(staffSignInThrottles.accessSubject, pair.accessSubject)))
    .get() ?? null;

function waitingUntil(db: LedgerDb, pair: Pair, clock: Clock): string | null {
  const t = throttleOf(db, pair);
  return t !== null && t.lockedUntil !== null && t.lockedUntil > clock.now() ? t.lockedUntil : null;
}

function failed(db: LedgerDb, pair: Pair, target: StaffRow | null, deps: StaffSignInDeps): StaffSignIn {
  const now = deps.clock.now();
  const failures = (throttleOf(db, pair)?.failures ?? 0) + 1;
  const delay = signInDelayMs(failures);
  const lockedUntil = delay > 0 ? instantFromMs(toMs(now) + delay) : null;
  db.insert(staffSignInThrottles)
    .values({ ...pair, failures, lockedUntil, lastFailedAt: now })
    .onConflictDoUpdate({ target: [staffSignInThrottles.username, staffSignInThrottles.accessSubject], set: { failures, lockedUntil, lastFailedAt: now } })
    .run();
  deps.auditFor(db).record({
    actor: STAFF_SIGN_IN_ACTOR,
    event: "identity.staff.sign_in_failed",
    entityId: target?.staffId ?? UNKNOWN_STAFF,
    payload: { staffId: target?.staffId ?? null, accessSubjectId: pair.accessSubject, failures, waiting: lockedUntil !== null },
  });
  return { outcome: "refused", reason: "bad_credentials" };
}

function succeeded(db: LedgerDb, pair: Pair, row: StaffRow, deps: StaffSignInDeps): StaffSignIn {
  const now = deps.clock.now();
  db.update(staff).set({ lastSignInAt: now }).where(eq(staff.staffId, row.staffId)).run();
  db.delete(staffSignInThrottles)
    .where(and(eq(staffSignInThrottles.username, pair.username), eq(staffSignInThrottles.accessSubject, pair.accessSubject)))
    .run();
  const session = openSession(db, { kind: "STAFF", staffId: row.staffId }, deps.clock, STAFF_SESSION_MS);
  deps.auditFor(db).record({ actor: { kind: "staff", id: row.staffId, role: row.role }, event: "identity.staff.signed_in", entityId: row.staffId, payload: { role: row.role, accessSubjectId: pair.accessSubject, expiresAt: session.expiresAt } });
  return { outcome: "signed_in", staff: { staffId: row.staffId, username: row.username, role: row.role }, session };
}

/** Records the checked attempt in one transaction; the rows are re-read, so a concurrent change wins. */
function record(db: LedgerDb, pair: Pair, hashChecked: string, passwordOk: boolean, deps: StaffSignInDeps): StaffSignIn {
  const retryAt = waitingUntil(db, pair, deps.clock);
  if (retryAt !== null) return { outcome: "refused", reason: "waiting", retryAt };
  const target = staffNamed(db, pair.username);
  // A password changed, or the account disabled, while the hash was checked: the check proves nothing.
  if (target === null || target.status !== "ACTIVE" || target.passwordHash !== hashChecked || !passwordOk) return failed(db, pair, target, deps);
  return succeeded(db, pair, target, deps);
}

export async function signInStaff(ledger: Ledger, input: StaffSignInInput, deps: StaffSignInDeps): Promise<StaffSignIn> {
  const pair: Pair = { username: input.username.trim().toLowerCase().slice(0, MAX_USERNAME), accessSubject: input.accessSubject };
  if (pair.username === "" || input.password.length === 0 || input.password.length > MAX_PASSWORD_LENGTH) return { outcome: "refused", reason: "bad_credentials" };
  const retryAt = waitingUntil(ledger.db, pair, deps.clock);
  if (retryAt !== null) return { outcome: "refused", reason: "waiting", retryAt };
  const row = activeStaff(ledger.db, pair.username);
  const hash = row?.passwordHash ?? DUMMY_HASH;
  const passwordOk = (await (deps.verify ?? verifyPassword)(hash, input.password)) && row !== null;
  return ledger.tx((db) => record(db, pair, hash, passwordOk, deps));
}
