/**
 * Payout routes on the admin desk (FR-16, FR-17, AD-9, Stories 4.6 and 4.7). Any staff role may
 * list, open, release and copy (FR-24); the commands check the role again. Nothing here takes an
 * amount or an order list (INV-4): opening a payout has a strict empty body, the preview is built
 * from the server's snapshot, and the VietQR carries exactly its amount.
 *
 *   GET  /api/admin/payouts                       the list contract (filter[queue] is the tab), with both tab totals
 *   POST /api/admin/payouts/:customerId/claim     claim and preview, or "taken"
 *   POST /api/admin/payout-claims/:claimId/release  closing the panel
 *   POST /api/admin/payout-claims/:claimId/account  the full account number, audited
 */
import {
  payoutAccountResponseSchema,
  payoutClaimParamsSchema,
  payoutClaimRequestSchema,
  payoutClaimResponseSchema,
  payoutCustomerParamsSchema,
  payoutListResponseSchema,
  payoutReleaseResponseSchema,
  type ErrorCode,
  type PayoutClaimResponse,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { z } from "zod";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { Actor, CommandAudit } from "../../../platform/ports/audit.port";
import { staffActorOf, type StaffPrincipal } from "../../../platform/ports/staff-session.port";
import { openPayoutClaim, PayoutClaimError, releasePayoutClaim, revealClaimAccount, type ClaimOutcome, type PayoutClaimErrorCode } from "../payout-claim.command";
import { answerPayoutQueue } from "../payout-queue.list";

export interface PayoutRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** The audit port bound to one transaction's handle, for this actor. */
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
}

const STATUS_OF: Record<PayoutClaimErrorCode, ErrorCode> = {
  staff_only: "forbidden",
  customer_not_found: "not_found",
  claim_not_found: "not_found",
  not_your_claim: "forbidden",
  nothing_to_pay: "conflict",
  netting_only: "conflict",
  no_bank: "conflict",
  bank_held: "conflict",
  account_changed: "conflict",
  snapshot_mismatch: "conflict",
};

const refused = (code: PayoutClaimErrorCode): HttpError => new HttpError(STATUS_OF[code], `error.payout.${code}`);

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

function actorOf(staff: StaffPrincipal | null): Actor {
  if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  return staffActorOf(staff);
}

function inTx<T>(deps: PayoutRouteDeps, staff: StaffPrincipal | null, fn: (db: LedgerDb, by: CommandAudit) => T): T {
  const actor = actorOf(staff);
  try {
    return deps.ledger.tx((db) => fn(db, deps.audit(db, actor)));
  } catch (error) {
    if (error instanceof PayoutClaimError) throw refused(error.code);
    throw error;
  }
}

/** The response for an outcome; a refusal becomes its error envelope after its transaction committed. */
function previewOf(outcome: ClaimOutcome): PayoutClaimResponse {
  if (outcome.kind === "refused") throw refused(outcome.code);
  if (outcome.kind === "taken") return { outcome: "taken", staffName: outcome.staffName };
  const { claim, snapshot } = outcome;
  const bank = snapshot.bank;
  return {
    outcome: "claimed",
    claimId: claim.claimId,
    transferReference: claim.transferReference,
    openedAt: claim.openedAt,
    customerId: snapshot.customerId,
    customerCode: snapshot.customerCode,
    customerName: snapshot.customerName,
    amount: snapshot.balance.payable,
    gross: snapshot.balance.gross,
    deductedNext: snapshot.balance.deductedNext,
    bankName: bank === null ? null : (bank.vietQrBank?.shortName ?? bank.bankName),
    holderName: bank?.holderName ?? null,
    accountLastFour: bank?.lastFour ?? "",
    qrPayload: outcome.qrPayload,
    qrMissing: outcome.qrMissing,
    flags: [...outcome.flags],
    orders: snapshot.orders.map((o) => ({ orderId: o.orderId, productName: o.productName, productImageUrl: o.productImageUrl, cashback: o.cashback, settled: o.settled })),
    bonuses: snapshot.bonuses.map((b) => ({ awardId: b.awardId, orderId: b.orderId, campaignName: b.campaignName, amount: b.amount })),
    clawbacks: [...snapshot.clawbacks],
    warning: outcome.warning,
  };
}

export function payoutRoutes(deps: PayoutRouteDeps): StaffRoutes {
  const { clock } = deps;
  return (add) => {
    add({ method: "GET", url: "/api/admin/payouts", handler: async (request) => payoutListResponseSchema.parse(answerPayoutQueue(deps.ledger, request.query, clock)) });
    add({
      method: "POST",
      url: "/api/admin/payouts/:customerId/claim",
      handler: async (request, _reply, { staff }) => {
        parsed(payoutClaimRequestSchema, request.body ?? {});
        const { customerId } = parsed(payoutCustomerParamsSchema, request.params);
        const outcome = inTx(deps, staff, (db, by) => openPayoutClaim(db, customerId, { clock, by }));
        return payoutClaimResponseSchema.parse(previewOf(outcome));
      },
    });
    add({
      method: "POST",
      url: "/api/admin/payout-claims/:claimId/release",
      handler: async (request, _reply, { staff }) => {
        parsed(payoutClaimRequestSchema, request.body ?? {});
        const { claimId } = parsed(payoutClaimParamsSchema, request.params);
        const claim = inTx(deps, staff, (db, by) => releasePayoutClaim(db, claimId, { clock, by }));
        return payoutReleaseResponseSchema.parse({ claimId: claim.claimId, status: claim.status });
      },
    });
    add({
      method: "POST",
      url: "/api/admin/payout-claims/:claimId/account",
      handler: async (request, _reply, { staff }) => {
        parsed(payoutClaimRequestSchema, request.body ?? {});
        const { claimId } = parsed(payoutClaimParamsSchema, request.params);
        return payoutAccountResponseSchema.parse({ accountNumber: inTx(deps, staff, (db, by) => revealClaimAccount(db, claimId, { clock, by })) });
      },
    });
  };
}
