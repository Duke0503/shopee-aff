/**
 * Stories 3.9 and 4.2: review cases are resolved by staff with the admin or employee role, checked
 * in the commands themselves and reached through the staff route group on the admin host.
 */
import type { Clock } from "@cashback/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { applyReviewCase, dismissReviewCase, previewReviewApply } from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import type { Actor } from "../src/platform/ports/audit.port";
import { applyDepsFor, reviewReadDepsFor } from "../src/reconcile/apply-deps";
import { apply, awaiting, closeLedgers, freshLedger, HOUR, movingClock } from "./helpers/order-ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { accessJwt, addStaff, ADMIN_HOST, deskServers, generatedPassword, ORIGIN, PUBLIC_HOST, setCookieValue } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

function withCase(): { ledger: Ledger; clock: Clock & { advance(ms: number): void }; caseId: number } {
  const ledger = freshLedger();
  const clock = movingClock("2026-10-30T02:00:00.000Z");
  apply(ledger, awaiting("261020NOCU0001", [20000], { subIds: ["NOBODY", "REQ1", "", "", ""] }), clock);
  clock.advance(HOUR);
  const caseId = (ledger.sqlite.prepare("SELECT case_id FROM review_cases WHERE status = 'OPEN'").get() as { case_id: number }).case_id;
  return { ledger, clock, caseId };
}

function asActor(ledger: Ledger, clock: Clock, actor: Actor, fn: "apply" | "dismiss" | "preview", caseId: number) {
  const input = { caseId, reason: "checked with the customer" };
  if (fn === "preview") return previewReviewApply(ledger.db, input, reviewReadDepsFor(ledger.db, clock, actor, true));
  return ledger.tx((db) => {
    const deps = applyDepsFor(db, clock, { production: true, actor });
    return fn === "apply" ? applyReviewCase(db, input, deps) : dismissReviewCase(db, input, deps);
  });
}

describe("review commands check the staff role (Story 3.9 note, Story 4.2)", () => {
  it("an employee and an admin may apply or dismiss a review case", () => {
    const a = withCase();
    expect(asActor(a.ledger, a.clock, { kind: "staff", id: "lan", role: "EMPLOYEE" }, "apply", a.caseId)).toMatchObject({ resolution: "APPLIED" });
    const b = withCase();
    expect(asActor(b.ledger, b.clock, { kind: "staff", id: "root", role: "ADMIN" }, "dismiss", b.caseId)).toMatchObject({ resolution: "DISMISSED" });
  });

  it("an actor without a staff role is refused with staff_only by every review command, and nothing is written", () => {
    const { ledger, clock, caseId } = withCase();
    const before = ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_entries").get();
    const forged = { kind: "staff", id: "lan", role: "OWNER" } as unknown as Actor;
    for (const actor of [forged, { kind: "customer", id: "C1" } as Actor, { kind: "system", id: "reconcile" } as Actor, { kind: "staff", id: "lan" } as unknown as Actor]) {
      for (const fn of ["apply", "dismiss", "preview"] as const) {
        expect(() => asActor(ledger, clock, actor, fn, caseId), `${actor.kind} ${fn}`).toThrow(expect.objectContaining({ code: "staff_only" }));
      }
    }
    expect(ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_entries").get()).toEqual(before);
    expect(ledger.sqlite.prepare("SELECT status FROM review_cases WHERE case_id = ?").get(caseId)).toEqual({ status: "OPEN" });
  });
});

describe("review case routes on the admin host (Story 4.2)", () => {
  async function desk() {
    const c = withCase();
    const password = generatedPassword();
    await addStaff(c.ledger, "lan", "EMPLOYEE", password);
    servers = deskServers(c.ledger, c.clock);
    const app = servers.publicApp;
    const headers = (extra: Record<string, string> = {}) => ({ host: ADMIN_HOST, origin: ORIGIN, [ACCESS_JWT_HEADER]: accessJwt(c.clock), ...extra });
    const signIn = await app.inject({ method: "POST", url: "/api/admin/session", headers: headers(), payload: { username: "lan", password } });
    const cookie = `${STAFF_SESSION_COOKIE}=${setCookieValue(signIn.headers["set-cookie"], STAFF_SESSION_COOKIE) ?? ""}`;
    const post = (url: string, payload: object, extra: Record<string, string> = { cookie }) => app.inject({ method: "POST", url, headers: headers(extra), payload });
    return { ...c, post, cookie };
  }

  it("an employee previews and dismisses a case; the audit entry names the staff member", async () => {
    const d = await desk();
    const preview = await d.post(`/api/admin/review-cases/${d.caseId}/preview`, { reason: "sub_id1 typo", customerId: "C1" });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ caseId: d.caseId, orderId: "261020NOCU0001", customerId: "C1", to: "AWAITING_APPROVAL" });
    const dismissed = await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "not ours" });
    expect([dismissed.statusCode, dismissed.json()]).toEqual([200, { caseId: d.caseId, orderId: null, resolution: "DISMISSED" }]);
    expect(d.ledger.sqlite.prepare("SELECT actor_kind, actor_id FROM audit_entries WHERE event = 'orders.review_case.dismissed'").all()).toEqual([{ actor_kind: "staff", actor_id: "lan" }]);
  });

  it("review item 10: a preview only reads, so it answers while another connection holds the write lock", async () => {
    const d = await desk();
    const other = new Database(d.ledger.sqlite.name, { timeout: 0 });
    other.exec("BEGIN IMMEDIATE");
    try {
      const preview = await d.post(`/api/admin/review-cases/${d.caseId}/preview`, { reason: "sub_id1 typo", customerId: "C1" });
      expect(preview.statusCode).toBe(200);
      expect((await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "not ours" })).statusCode).toBe(503);
    } finally {
      other.exec("ROLLBACK");
      other.close();
    }
  }, 15_000);

  it("refusals keep their meaning: no reason 400, unknown case 404, resolved case 409, an amount in the body 400", async () => {
    const d = await desk();
    expect((await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "  " })).statusCode).toBe(400);
    expect((await d.post(`/api/admin/review-cases/99999/dismiss`, { reason: "x" })).statusCode).toBe(404);
    expect((await d.post(`/api/admin/review-cases/${d.caseId}/apply`, { reason: "x", cashback: 100000 })).statusCode).toBe(400);
    expect((await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "x" })).statusCode).toBe(200);
    const again = await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "x" });
    expect([again.statusCode, again.json().error.messageKey]).toEqual([409, "error.review_case.case_resolved"]);
  });

  it("the routes exist only on the admin host and need the staff session", async () => {
    const d = await desk();
    expect((await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "x" }, { cookie: d.cookie, host: PUBLIC_HOST })).statusCode).toBe(404);
    expect((await d.post(`/api/admin/review-cases/${d.caseId}/dismiss`, { reason: "x" }, {})).statusCode).toBe(401);
  });
});
