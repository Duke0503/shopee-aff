/**
 * A password the customer chooses on the website (AD-18, FR-9, FR-10, INV-8, NFR-6; Story 7.5).
 * The new password has at least 8 characters and is not the customer code; the current password
 * is asked for, so a phone left signed in cannot lock its owner out. A wrong current password
 * counts like a wrong sign-in (the code's and the client's doubling delay of Story 7.2), so the
 * page cannot be used to guess it, and a code waiting out its delay is refused with the time.
 *
 * Both hashes are worked outside any transaction (argon2id runs on the thread pool). One
 * transaction then re-reads the customer (a /matkhau meanwhile wins), stores the new hash, ends
 * every other open session of the customer with NEW_PASSWORD while this one stays signed in,
 * clears the customer's sign-in throttle rows and writes one audit entry that names no password.
 */
import { MIN_CUSTOMER_PASSWORD } from "@cashback/contracts";
import { and, eq, isNull, ne } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import { CLIENT_KEY, signInFailed, signInWaiting, type CustomerSignInDeps } from "./customer-sign-in.command";
import { hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "./password-hash";
import { customerSignInThrottles, customers, sessions } from "./schema";
import { sessionTokenHash } from "./session-token";

export interface PasswordChangeInput {
  readonly customerId: string;
  /** The session making the change; it stays open. */
  readonly sessionToken: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly clientKey: string;
}

export type PasswordChange =
  | { readonly outcome: "changed"; readonly otherSessionsEnded: number }
  | { readonly outcome: "too_short" | "is_code" | "too_long" | "wrong_current" | "refused" }
  | { readonly outcome: "waiting"; readonly retryAt: string };

export interface PasswordChangeDeps extends Omit<CustomerSignInDeps, "verify"> {
  readonly verify?: (hash: string, password: string) => Promise<boolean>;
  readonly hash?: (password: string) => Promise<string>;
}

/** Whether a chosen password may be used: the rule a field error names. */
export function chosenPasswordProblem(password: string, customerCode: string): "too_short" | "is_code" | "too_long" | null {
  if (password.length < MIN_CUSTOMER_PASSWORD) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";
  if (password.trim().toUpperCase() === customerCode.toUpperCase()) return "is_code";
  return null;
}

const customerRow = (db: LedgerDb, customerId: string) => db.select().from(customers).where(eq(customers.customerId, customerId)).get() ?? null;

function store(db: LedgerDb, input: PasswordChangeInput, code: string, hash: string, deps: PasswordChangeDeps): PasswordChange {
  const now = deps.clock.now();
  db.update(customers).set({ passwordHash: hash, passwordSetAt: now, failedSignIns: 0, lockedUntil: null }).where(eq(customers.customerId, input.customerId)).run();
  db.delete(customerSignInThrottles).where(eq(customerSignInThrottles.customerCode, code)).run();
  const keep = sessionTokenHash(input.sessionToken) ?? "";
  const otherSessionsEnded = db
    .update(sessions)
    .set({ endedAt: now, endReason: "NEW_PASSWORD" })
    .where(and(eq(sessions.customerId, input.customerId), eq(sessions.kind, "CUSTOMER"), isNull(sessions.endedAt), ne(sessions.tokenHash, keep)))
    .run().changes;
  deps.auditFor(db).record({ actor: { kind: "customer", id: input.customerId }, event: "identity.customer.password_changed", entityId: input.customerId, payload: { customerId: input.customerId, sessionsEnded: otherSessionsEnded, via: "website" } });
  return { outcome: "changed", otherSessionsEnded };
}

export async function changeCustomerPassword(ledger: Ledger, input: PasswordChangeInput, deps: PasswordChangeDeps): Promise<PasswordChange> {
  const row = customerRow(ledger.db, input.customerId);
  const code = row?.customerCode ?? null;
  if (row === null || code === null || row.role !== "USER" || row.status !== "ACTIVE" || row.passwordHash === null || !CLIENT_KEY.test(input.clientKey)) return { outcome: "refused" };
  const problem = chosenPasswordProblem(input.newPassword, code);
  if (problem !== null) return { outcome: problem };
  const attempt = { code, clientKey: input.clientKey };
  const waitingAt = signInWaiting(ledger.db, attempt, deps.clock);
  if (waitingAt !== null) return { outcome: "waiting", retryAt: waitingAt };
  const checked = row.passwordHash;
  const ok = input.currentPassword !== "" && (await (deps.verify ?? verifyPassword)(checked, input.currentPassword));
  const hash = ok ? await (deps.hash ?? hashPassword)(input.newPassword) : null;
  return ledger.tx((db): PasswordChange => {
    const retryAt = signInWaiting(db, attempt, deps.clock);
    if (retryAt !== null) return { outcome: "waiting", retryAt };
    const now = customerRow(db, input.customerId);
    if (now === null || now.status !== "ACTIVE" || now.passwordHash !== checked) return { outcome: "refused" };
    if (hash === null) {
      signInFailed(db, attempt, now, deps);
      return { outcome: "wrong_current" };
    }
    return store(db, input, code, hash, deps);
  });
}
