import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { findCustomerIdByAnyId } from "../infrastructure/customer.repository";
import { createSession } from "../infrastructure/session.repository";
import { isLocked, nextFailedAttempt } from "../domain/login-decision";
import { verifyPassword } from "../domain/password-hash";
import { SESSION_BYTES, SESSION_DAYS } from "../domain/password-policy";

/** Ports `accounts.py::authenticate` — enough to reason about, nothing hidden. */
export interface SignInResult {
  ok: boolean;
  reason?: string;
  customerId?: string;
  token?: string;
}

/** Local-naive ISO, matching the Python's stamps (no UTC shift). */
export function nowLocalIso(at: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

function addDaysLocal(iso: string, days: number): string {
  return nowLocalIso(new Date(Date.parse(iso) + days * 86_400_000));
}

export function signIn(db: Db, name: string, password: string, nowIso: string): SignInResult {
  const customerId = findCustomerIdByAnyId(db, name);
  if (!customerId) return { ok: false, reason: "bad_credentials" };

  const row = db.select().from(customers).where(eq(customers.customerId, customerId)).get();
  if (!row) return { ok: false, reason: "bad_credentials" };
  if (isLocked(row.lockedUntil, nowIso)) return { ok: false, reason: "locked" };
  if (row.status !== "active") return { ok: false, reason: "bad_credentials" };

  if (!verifyPassword(password, row.passwordHash)) {
    const next = nextFailedAttempt(
      { failedLogins: row.failedLogins, lockedUntil: row.lockedUntil, status: row.status },
      nowIso,
    );
    db.update(customers)
      .set({ failedLogins: next.failedLogins, lockedUntil: next.lockedUntil })
      .where(eq(customers.customerId, customerId))
      .run();
    return { ok: false, reason: next.outcome };
  }

  const token = randomBytes(SESSION_BYTES).toString("base64url");
  createSession(db, customerId, token, nowIso, addDaysLocal(nowIso, SESSION_DAYS));
  db.update(customers)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: nowIso })
    .where(eq(customers.customerId, customerId))
    .run();
  return { ok: true, customerId, token };
}
