/**
 * Payout routes on the admin desk (FR-16, FR-17, AD-9, Stories 4.6, 4.7, 4.8 and 4.11). Any staff
 * role may list, open, release, copy and confirm (FR-24); only an admin writes off a clawback. The
 * commands check the role again. Nothing here takes an amount or an order list (INV-4): opening a
 * payout has a strict empty body, confirm takes only the snapshot hash, the preview is built from
 * the server's snapshot, and the VietQR carries exactly its amount. There is no route that pays
 * an order directly: an order is paid only by confirming a claim whose snapshot still holds.
 *
 *   GET  /api/admin/payouts                         the list contract (filter[queue] is the tab), with both tab totals
 *   POST /api/admin/payouts/:customerId/claim       claim and preview, or "taken"
 *   POST /api/admin/payout-claims/:claimId/release  closing the panel
 *   POST /api/admin/payout-claims/:claimId/account  the full account number, audited
 *   POST /api/admin/payout-claims/:claimId/confirm  record the payout once; 409 amount_changed when the snapshot moved
 *   POST /api/admin/clawbacks/:clawbackId/write-off admin only: close what a clawback still owes, with a reason
 */
import {
  clawbackParamsSchema,
  clawbackWriteOffRequestSchema,
  clawbackWriteOffResponseSchema,
  payoutAccountResponseSchema,
  payoutClaimParamsSchema,
  payoutClaimRequestSchema,
  payoutClaimResponseSchema,
  payoutConfirmRequestSchema,
  payoutConfirmResponseSchema,
  payoutCustomerParamsSchema,
  payoutListResponseSchema,
  payoutReleaseResponseSchema,
  type ErrorCode,
  type PayoutClaimResponse,
  type PayoutConfirmResponse,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { z } from "zod";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { Logger } from "../../../platform/log/logger";
import type { Actor, CommandAudit } from "../../../platform/ports/audit.port";
import type { OutboxPort } from "../../../platform/ports/outbox.port";
import { staffActorOf, type StaffPrincipal } from "../../../platform/ports/staff-session.port";
import { OrderPayoutError } from "../../orders/index";
import { WriteOffError, writeOffClawback, type WriteOffErrorCode } from "../clawback-write-off.command";
import { confirmPayout, type ConfirmOutcome } from "../payout-confirm.command";
import { openPayoutClaim, PayoutClaimError, releasePayoutClaim, revealClaimAccount, type ClaimOutcome, type PayoutClaimErrorCode } from "../payout-claim.command";
import { answerPayoutQueue } from "../payout-queue.list";
import { nettingOf, PayoutSnapshotError } from "../payout-snapshot.query";

export interface PayoutRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** The audit port bound to one transaction's handle, for this actor. */
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
  /** The outbox port bound to one transaction's handle (messaging, AD-16). */
  readonly outbox: (db: LedgerDb, by: CommandAudit) => OutboxPort;
  /** The cutover go/no-go flag of Story 8.8; absent, confirm is never paused. */
  readonly confirmPaused?: () => boolean;
  /** Where an internal check's refusal is logged with its detail (ids and counts only). */
  readonly logger?: Logger;
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
  other_claim_open: "conflict",
  confirm_paused: "conflict",
};

const WRITE_OFF_STATUS: Record<WriteOffErrorCode, ErrorCode> = { admin_only: "forbidden", clawback_not_found: "not_found", clawback_closed: "conflict", reason_required: "invalid_request" };

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
    if (error instanceof PayoutClaimError) {
      if (error.detail !== undefined) deps.logger?.warn({ code: error.code, detail: error.detail }, "payouts.payout.confirm_refused");
      throw refused(error.code);
    }
    if (error instanceof WriteOffError) throw new HttpError(WRITE_OFF_STATUS[error.code], `error.clawback.${error.code}`);
    if (error instanceof PayoutSnapshotError) throw refused("snapshot_mismatch");
    // R2: a covered order that is no longer APPROVED, unpaid and the customer's rolls the confirm back.
    if (error instanceof OrderPayoutError) throw new HttpError("conflict", "error.payout.amount_changed");
    throw error;
  }
}

/** The response for an outcome; a refusal becomes its error envelope after its transaction committed. */
function previewOf(outcome: ClaimOutcome): PayoutClaimResponse {
  if (outcome.kind === "refused") throw refused(outcome.code);
  if (outcome.kind === "taken") return { outcome: "taken", staffName: outcome.staffName };
  const { claim, snapshot } = outcome;
  const bank = snapshot.bank;
  const netting = nettingOf(snapshot);
  return {
    outcome: "claimed",
    claimId: claim.claimId,
    snapshotHash: claim.snapshotHash,
    transferReference: claim.transferReference,
    openedAt: claim.openedAt,
    customerId: snapshot.customerId,
    customerCode: snapshot.customerCode,
    customerName: snapshot.customerName,
    amount: snapshot.balance.payable,
    gross: snapshot.balance.gross,
    deductedNext: snapshot.balance.deductedNext,
    netted: netting.netted,
    carriedForward: netting.carriedForward,
    bankName: bank === null ? null : (bank.vietQrBank?.shortName ?? bank.bankName),
    holderName: bank?.holderName ?? null,
    accountLastFour: bank?.lastFour ?? "",
    qrPayload: outcome.qrPayload,
    qrMissing: outcome.qrMissing,
    flags: [...outcome.flags],
    orders: snapshot.orders.map((o) => ({ orderId: o.orderId, productName: o.productName, productImageUrl: o.productImageUrl, cashback: o.cashback, settled: o.settled })),
    bonuses: snapshot.bonuses.map((b) => ({ awardId: b.awardId, orderId: b.orderId, campaignName: b.campaignName, amount: b.amount })),
    clawbacks: snapshot.clawbacks.map((c) => ({ clawbackId: c.clawbackId, orderId: c.orderId, open: c.open })),
    warning: outcome.warning,
  };
}

/** A recorded payout, or the "changed" refusal: nothing was written and the panel re-opens for a new preview. */
function confirmedOf(outcome: ConfirmOutcome): PayoutConfirmResponse {
  if (outcome.kind === "changed") throw new HttpError("conflict", "error.payout.amount_changed");
  return { outcome: "recorded", ...outcome.payout, replay: outcome.replay };
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
    add({
      method: "POST",
      url: "/api/admin/payout-claims/:claimId/confirm",
      handler: async (request, _reply, { staff }) => {
        const { snapshotHash } = parsed(payoutConfirmRequestSchema, request.body ?? {});
        const { claimId } = parsed(payoutClaimParamsSchema, request.params);
        const outcome = inTx(deps, staff, (db, by) => confirmPayout(db, { claimId, snapshotHash }, { clock, by, outbox: deps.outbox(db, by), ...(deps.confirmPaused ? { confirmPaused: deps.confirmPaused } : {}) }));
        return payoutConfirmResponseSchema.parse(confirmedOf(outcome));
      },
    });
    add({
      method: "POST",
      url: "/api/admin/clawbacks/:clawbackId/write-off",
      handler: async (request, _reply, { staff }) => {
        if (staff?.role !== "ADMIN") throw new HttpError("forbidden", "error.clawback.admin_only");
        const { reason } = parsed(clawbackWriteOffRequestSchema, request.body ?? {});
        const { clawbackId } = parsed(clawbackParamsSchema, request.params);
        return clawbackWriteOffResponseSchema.parse(inTx(deps, staff, (db, by) => writeOffClawback(db, { clawbackId, reason }, { clock, by })));
      },
    });
  };
}
