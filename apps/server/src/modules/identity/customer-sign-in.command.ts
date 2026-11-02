/**
 * Customer sign-in on the website with the customer code and the password from /matkhau (AD-18,
 * FR-9, D21, INV-5, INV-8; Story 7.2). The answer never tells which codes exist: a real code, a
 * code nobody holds, a customer without a password yet and a disabled one all go through the
 * same steps, get the same refusal and wait the same doubling delay after five failures.
 *
 * The delay is kept per (code, client key), the client key being an HMAC of the caller's address
 * (platform/http/client-key.ts), so failures from one place never lock the customer out anywhere
 * else; and one client that fails 20 times in 10 minutes, on any codes, waits 10 minutes
 * (sign-in-client-window.ts). Every throttle row is in customer_sign_in_throttles and
 * customer_sign_in_clients; the hourly sign-in job prunes them.
 *
 * The password is checked with argon2id before the transaction, on the dummy hash when there is
 * no account, so the timing matches too. One transaction then re-reads the customer once,
 * re-checks the waits and either counts the failure or opens a session that lasts until sign-out
 * or a new password. A failure on a real customer is audited; one on a code nobody holds is only
 * counted (burst alert, hourly tally), so a spray of made-up codes writes no audit row.
 */
import { instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { and, eq } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { Actor, AuditPort } from "../../platform/ports/audit.port";
import { clientAfterFailure } from "./domain/sign-in-client-window";
import type { SignInBurstWatch } from "./domain/sign-in-burst";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password-hash";
import { customerSignInClients, customerSignInThrottles, customers } from "./schema";
import { openSession, type OpenedSession } from "./session.command";
import { countFailure, waitingUntil, type ThrottleStore } from "./sign-in-throttle";
import type { UnknownSignInTally } from "./sign-in-tally";
import { DUMMY_HASH } from "./staff-sign-in.command";

export interface CustomerSignInInput {
  readonly customerCode: string;
  readonly password: string;
  /** The HMAC of the caller's address; never the address. */
  readonly clientKey: string;
}

export type CustomerSignIn =
  | { readonly outcome: "signed_in"; readonly customerId: string; readonly customerCode: string; readonly session: OpenedSession }
  | { readonly outcome: "refused"; readonly reason: "bad_credentials" | "waiting"; readonly retryAt?: string };

export interface CustomerSignInDeps {
  readonly clock: Clock;
  /** The audit and alert ports bound to the sign-in's own transaction handle. */
  readonly auditFor: (db: LedgerDb) => AuditPort;
  readonly alertsFor: (db: LedgerDb) => AlertPort;
  /** One watch per server process: the failures across every code and client. */
  readonly burst: SignInBurstWatch;
  /** Failures on codes nobody holds, written once an hour by the sign-in job. */
  readonly unknown: UnknownSignInTally;
  readonly verify?: (hash: string, password: string) => Promise<boolean>;
}

export const CUSTOMER_SIGN_IN_ACTOR: Actor = { kind: "system", id: "customer-sign-in" };
export const SIGN_IN_BURST_ALERT = { kind: "customer_sign_in_burst", severity: "high" } as const;

const CODE = /^DP\d{1,9}$/;
export const CLIENT_KEY = /^[0-9a-f]{32}$/;

/** The code as the server compares it, or null when it is not one. */
export function signInCode(typed: string): string | null {
  const code = typed.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

type CustomerRecord = typeof customers.$inferSelect;
export type SignInAttempt = { readonly code: string; readonly clientKey: string };
type Attempt = SignInAttempt;

const customerWithCode = (db: LedgerDb, code: string): CustomerRecord | null => db.select().from(customers).where(eq(customers.customerCode, code)).get() ?? null;

/** Only an active customer (never staff or the guest account) with a password can sign in. */
const canSignIn = (row: CustomerRecord | null): row is CustomerRecord & { passwordHash: string } => row !== null && row.role === "USER" && row.status === "ACTIVE" && row.passwordHash !== null;

const codeThrottle = (db: LedgerDb, { code, clientKey }: Attempt): ThrottleStore => {
  const key = and(eq(customerSignInThrottles.customerCode, code), eq(customerSignInThrottles.clientKey, clientKey));
  return {
    read: () => db.select().from(customerSignInThrottles).where(key).get() ?? null,
    save: (next, at) =>
      void db
        .insert(customerSignInThrottles)
        .values({ customerCode: code, clientKey, ...next, lastFailedAt: at })
        .onConflictDoUpdate({ target: [customerSignInThrottles.customerCode, customerSignInThrottles.clientKey], set: { ...next, lastFailedAt: at } })
        .run(),
  };
};

const clientRow = (db: LedgerDb, clientKey: string) => db.select().from(customerSignInClients).where(eq(customerSignInClients.clientKey, clientKey)).get() ?? null;

function clientWaitingUntil(db: LedgerDb, clientKey: string, clock: Clock): string | null {
  const lockedUntil = clientRow(db, clientKey)?.lockedUntil ?? null;
  return lockedUntil !== null && lockedUntil > clock.now() ? lockedUntil : null;
}

function countClientFailure(db: LedgerDb, clientKey: string, clock: Clock): void {
  const prev = clientRow(db, clientKey);
  const ms = (at: string): number => toMs(parseInstant(at));
  const next = clientAfterFailure(prev === null ? null : { windowStartedMs: ms(prev.windowStartedAt), failures: prev.failures, lockedUntilMs: prev.lockedUntil === null ? null : ms(prev.lockedUntil) }, ms(clock.now()));
  const values = { windowStartedAt: instantFromMs(next.windowStartedMs), failures: next.failures, lockedUntil: next.lockedUntilMs === null ? null : instantFromMs(next.lockedUntilMs) };
  db.insert(customerSignInClients).values({ clientKey, ...values }).onConflictDoUpdate({ target: customerSignInClients.clientKey, set: values }).run();
}

/** The later of the code's wait and the client's wait, or null (also checked by a password change, Story 7.5). */
export function signInWaiting(db: LedgerDb, attempt: Attempt, clock: Clock): string | null {
  const waits = [waitingUntil(codeThrottle(db, attempt), clock), clientWaitingUntil(db, attempt.clientKey, clock)].filter((w): w is string => w !== null);
  return waits.length === 0 ? null : (waits.sort().at(-1) ?? null);
}

/** Counts one wrong password for the code and the client, audited for a real customer (also a password change, Story 7.5). */
export function signInFailed(db: LedgerDb, attempt: Attempt, target: CustomerRecord | null, deps: Omit<CustomerSignInDeps, "verify">): CustomerSignIn {
  const { failures, lockedUntil } = countFailure(codeThrottle(db, attempt), deps.clock);
  countClientFailure(db, attempt.clientKey, deps.clock);
  if (target === null) deps.unknown.note();
  else deps.auditFor(db).record({ actor: CUSTOMER_SIGN_IN_ACTOR, event: "identity.customer.sign_in_failed", entityId: target.customerId, payload: { customerId: target.customerId, failures, waiting: lockedUntil !== null } });
  if (deps.burst.failed(toMs(deps.clock.now()))) deps.alertsFor(db).alert(SIGN_IN_BURST_ALERT.kind, SIGN_IN_BURST_ALERT.severity);
  return { outcome: "refused", reason: "bad_credentials" };
}

function succeeded(db: LedgerDb, row: CustomerRecord, attempt: Attempt, deps: CustomerSignInDeps): CustomerSignIn {
  db.update(customers).set({ lastSignInAt: deps.clock.now() }).where(eq(customers.customerId, row.customerId)).run();
  db.delete(customerSignInThrottles)
    .where(and(eq(customerSignInThrottles.customerCode, attempt.code), eq(customerSignInThrottles.clientKey, attempt.clientKey)))
    .run();
  const session = openSession(db, { kind: "CUSTOMER", customerId: row.customerId }, deps.clock, null);
  deps.auditFor(db).record({ actor: { kind: "customer", id: row.customerId }, event: "identity.customer.signed_in", entityId: row.customerId, payload: { customerId: row.customerId } });
  return { outcome: "signed_in", customerId: row.customerId, customerCode: row.customerCode ?? "", session };
}

/** Records the checked attempt; the customer is read once more, so a password issued meanwhile wins. */
function record(db: LedgerDb, attempt: Attempt, hashChecked: string, passwordOk: boolean, deps: CustomerSignInDeps): CustomerSignIn {
  const retryAt = signInWaiting(db, attempt, deps.clock);
  if (retryAt !== null) return { outcome: "refused", reason: "waiting", retryAt };
  const target = customerWithCode(db, attempt.code);
  if (!canSignIn(target) || target.passwordHash !== hashChecked || !passwordOk) return signInFailed(db, attempt, target, deps);
  return succeeded(db, target, attempt, deps);
}

export async function signInCustomer(ledger: Ledger, input: CustomerSignInInput, deps: CustomerSignInDeps): Promise<CustomerSignIn> {
  const code = signInCode(input.customerCode);
  if (code === null || !CLIENT_KEY.test(input.clientKey) || input.password.length === 0 || input.password.length > MAX_PASSWORD_LENGTH) return { outcome: "refused", reason: "bad_credentials" };
  const attempt: Attempt = { code, clientKey: input.clientKey };
  const retryAt = signInWaiting(ledger.db, attempt, deps.clock);
  if (retryAt !== null) return { outcome: "refused", reason: "waiting", retryAt };
  const row = customerWithCode(ledger.db, code);
  const hash = canSignIn(row) ? row.passwordHash : DUMMY_HASH;
  const passwordOk = (await (deps.verify ?? verifyPassword)(hash, input.password)) && canSignIn(row);
  return ledger.tx((db) => record(db, attempt, hash, passwordOk, deps));
}
