/**
 * The signed-in customer's account on the public listener (FR-9, FR-10, AD-17, AD-18, AD-23,
 * M-7, INV-5, INV-8, INV-9, INV-11; Story 7.5):
 *
 *   GET    /api/banks              the VietQR bank list for the picker (public, cached a day)
 *   POST   /api/me/bank-account    save or change the account; HELD until confirmed in Zalo
 *   DELETE /api/me/bank-account    erase the account
 *   POST   /api/me/password        a password the customer chooses
 *
 * The customer is the one the session cookie names; every change needs the website's own Origin.
 * The bank is a BIN from the list, so the server never guesses one; the number is normalised (4 to
 * 30 letters and digits) and the holder folded to upper case as banks print it. Each broken rule
 * is said under its own field. Without a FINGERPRINT_KEY of 32 characters nothing is saved. The
 * answer and the log carry the bank, the holder and the last four digits at most.
 */
import {
  BANK_LIST_PATH,
  bankAccountErasedSchema,
  bankAccountSavedSchema,
  bankAccountSaveSchema,
  bankListSchema,
  MY_BANK_ACCOUNT_PATH,
  MY_PASSWORD_PATH,
  passwordChangedSchema,
  passwordChangeSchema,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ACCOUNT_NUMBER_RULE,
  changeCustomerPassword,
  customerSessionOf,
  eraseWebsiteBankAccount,
  holderNameOf,
  normaliseAccountNumber,
  saveWebsiteBankAccount,
  VIETQR_BANKS,
  type PasswordChangeDeps,
} from "../modules/identity/index";
import { outboxFor } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import type { Ledger } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { requireOrigin } from "../platform/http/origin.guard";
import type { PublicRoutes } from "../platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../platform/http/session-cookie";
import { FINGERPRINT_KEY_MIN } from "../links/assistant-bank.routes";

export interface AccountRouteDeps extends Omit<PasswordChangeDeps, "clock"> {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** FINGERPRINT_KEY; null when the config has none. */
  readonly fingerprintKey: string | null;
  readonly origins: readonly string[];
  readonly clientKey: (request: FastifyRequest) => string;
}

const BANK_LIST = bankListSchema.parse({ banks: VIETQR_BANKS.map((b) => ({ bin: b.bin, shortName: b.shortName, name: b.name })) });

/** The session's customer and token; no session is 401. Never cached. */
function signedIn(deps: AccountRouteDeps, request: FastifyRequest, reply: { header: (k: string, v: string) => unknown }): { customerId: string; token: string } {
  void reply.header("cache-control", "no-store");
  const token = readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
  const customerId = customerSessionOf(deps.ledger.db, token, deps.clock);
  if (customerId === null || token === null) throw new HttpError("unauthorized", "error.unauthorized");
  return { customerId, token };
}

/** The account the form describes, or every broken rule by field. */
function readForm(body: unknown) {
  const parsed = bankAccountSaveSchema.safeParse(body);
  if (!parsed.success) throw new HttpError("invalid_request", "error.invalid_request");
  const fields: Record<string, string> = {};
  const bank = VIETQR_BANKS.find((b) => b.bin === parsed.data.bankBin);
  if (bank === undefined) fields["bankBin"] = "error.bank.bank_unknown";
  const accountNumber = normaliseAccountNumber(parsed.data.accountNumber);
  if (!ACCOUNT_NUMBER_RULE.test(accountNumber)) fields["accountNumber"] = "error.bank.number_rule";
  const holderName = holderNameOf(parsed.data.holderName.trim().split(/\s+/));
  if (holderName === null) fields["holderName"] = "error.bank.holder_rule";
  if (!parsed.data.consent) fields["consent"] = "error.bank.consent_required";
  const first = Object.values(fields)[0];
  if (first !== undefined || bank === undefined || holderName === null) throw new HttpError("invalid_request", first ?? "error.invalid_request", fields);
  return { bank, accountNumber, holderName };
}

function bankRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  app.get(BANK_LIST_PATH, async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=86400");
    return BANK_LIST;
  });
  app.post(MY_BANK_ACCOUNT_PATH, async (request, reply) => {
    requireOrigin(request, deps.origins);
    const { customerId } = signedIn(deps, request, reply);
    const form = readForm(request.body);
    const key = deps.fingerprintKey;
    if (key === null || key.length < FINGERPRINT_KEY_MIN) throw new HttpError("conflict", "error.bank.unavailable");
    const saved = deps.ledger.tx((db) => {
      const by = commandAudit(db, deps.clock, { kind: "customer", id: customerId });
      return saveWebsiteBankAccount(db, { customerId, ...form }, { clock: deps.clock, fingerprintKey: key, by, outbox: outboxFor(db, deps.clock, by) });
    });
    request.log.info({ result: saved.result, held: saved.held }, "identity.website_bank.saved");
    return bankAccountSavedSchema.parse({ result: saved.result, bank: { bankName: saved.bankName, holderName: saved.holderName, lastFour: saved.lastFour, held: saved.held } });
  });
  app.delete(MY_BANK_ACCOUNT_PATH, async (request, reply) => {
    requireOrigin(request, deps.origins);
    const { customerId } = signedIn(deps, request, reply);
    const erased = deps.ledger.tx((db) => {
      const by = commandAudit(db, deps.clock, { kind: "customer", id: customerId });
      return eraseWebsiteBankAccount(db, customerId, { clock: deps.clock, by, outbox: outboxFor(db, deps.clock, by) });
    });
    return bankAccountErasedSchema.parse({ erased });
  });
}

const PASSWORD_FIELD: Record<string, [field: string, key: string]> = {
  too_short: ["newPassword", "error.password.too_short"],
  too_long: ["newPassword", "error.password.too_long"],
  is_code: ["newPassword", "error.password.is_code"],
  wrong_current: ["currentPassword", "error.password.wrong_current"],
};

function passwordRoute(app: FastifyInstance, deps: AccountRouteDeps): void {
  app.post(MY_PASSWORD_PATH, async (request, reply) => {
    requireOrigin(request, deps.origins);
    const { customerId, token } = signedIn(deps, request, reply);
    const body = passwordChangeSchema.safeParse(request.body);
    if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
    const input = { customerId, sessionToken: token, ...body.data, clientKey: deps.clientKey(request) };
    const changed = await changeCustomerPassword(deps.ledger, input, deps);
    request.log.info({ outcome: changed.outcome }, "identity.customer_password.answered");
    if (changed.outcome === "changed") return passwordChangedSchema.parse({ changed: true, otherSessionsEnded: changed.otherSessionsEnded });
    if (changed.outcome === "waiting") throw new HttpError("rate_limited", "error.customer_sign_in_waiting", { retryAt: changed.retryAt });
    const field = PASSWORD_FIELD[changed.outcome];
    if (field === undefined) throw new HttpError("forbidden", "error.forbidden");
    // A wrong current password is a field error, never 401: the session itself is still good.
    throw new HttpError("invalid_request", field[1], { [field[0]]: field[1] });
  });
}

export function accountRoutes(deps: AccountRouteDeps): PublicRoutes {
  return (app) => {
    bankRoutes(app, deps);
    passwordRoute(app, deps);
  };
}
