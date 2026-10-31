/**
 * Erasing a customer's personal data from the customer page (FR-35, NFR-6, D13, D26, Story 4.16).
 * Identity erases; the amounts it checks come from the payouts module's `getBalances` and the open
 * payout claims, and messaging withdraws whatever was not yet sent, all in one transaction, so the
 * parts meet here like the customer page itself.
 *
 *   POST /api/admin/customers/:customerKey/erase         any staff; refused while money is owed
 *   POST /api/admin/customers/:customerKey/force-erase   admin only, with a reason (ADMIN_ONLY_PATHS)
 *
 * The refusal names what is owed (payable and waiting, in dong), so the page can say why.
 */
import { customerErasedResponseSchema, customerEraseRequestSchema, customerKeyParamsSchema, type CustomerErasedResponse, type ErrorCode } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyRequest } from "fastify";

import { customerKeys, CustomerEraseError, deskCustomerOf, eraseCustomer, type EraseErrorCode } from "../modules/identity/index";
import { withdrawUnsent } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import { getBalances, hasOpenClaim } from "../modules/payouts/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRequest, StaffRoutes } from "../platform/http/staff-routes";
import { staffActorOf } from "../platform/ports/staff-session.port";

export interface CustomerEraseRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

const STATUS: Record<EraseErrorCode, ErrorCode> = {
  customer_not_found: "not_found",
  not_a_customer: "not_found",
  already_erased: "conflict",
  owed_money: "conflict",
  admin_only: "forbidden",
  reason_required: "invalid_request",
  claim_open: "conflict",
};

function refusal(error: unknown): unknown {
  if (!(error instanceof CustomerEraseError)) return error;
  const owed = error.owed === undefined ? undefined : { payable: String(error.owed.payable), waiting: String(error.owed.waiting) };
  return new HttpError(STATUS[error.code], `error.customer.${error.code}`, owed);
}

function customerIdOf(db: LedgerDb, request: FastifyRequest): string {
  const params = customerKeyParamsSchema.safeParse(request.params);
  const found = params.success ? deskCustomerOf(db, params.data.customerKey) : null;
  if (found === null) throw new HttpError("not_found", "error.customer.not_found");
  return found.customerId;
}

function erase(deps: CustomerEraseRouteDeps, request: FastifyRequest, context: StaffRequest, force: boolean): CustomerErasedResponse {
  const body = customerEraseRequestSchema.safeParse(request.body ?? {});
  if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
  if (context.staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  const actor = staffActorOf(context.staff);
  try {
    return deps.ledger.tx((db) => {
      const customerId = customerIdOf(db, request);
      const records = customerKeys(db, customerId)?.keys ?? [customerId];
      const balance = getBalances(db, [customerId])[0];
      const owed = { payable: balance?.payable ?? 0, waiting: balance?.waiting ?? 0 };
      const done = eraseCustomer(db, { customerId, owed, force, claimOpen: hasOpenClaim(db, records), ...(body.data.reason === undefined ? {} : { reason: body.data.reason }) }, { clock: deps.clock, by: commandAudit(db, deps.clock, actor) });
      withdrawUnsent(db, records);
      return done;
    });
  } catch (error) {
    throw refusal(error);
  }
}

export function customerEraseRoutes(deps: CustomerEraseRouteDeps): StaffRoutes {
  return (add) => {
    add({ method: "POST", url: "/api/admin/customers/:customerKey/erase", handler: async (request, _reply, context) => customerErasedResponseSchema.parse(erase(deps, request, context, false)) });
    add({ method: "POST", url: "/api/admin/customers/:customerKey/force-erase", adminOnly: true, handler: async (request, _reply, context) => customerErasedResponseSchema.parse(erase(deps, request, context, true)) });
  };
}
