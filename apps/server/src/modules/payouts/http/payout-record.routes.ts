/**
 * Routes on a recorded payout (FR-17, FR-18, FR-34, D41, D49; Stories 4.9 and 4.10).
 *
 *   POST /api/admin/payouts/:payoutId/proof   any staff: the proof image as a JPEG or PNG body, up to 8 MB
 *   GET  /api/admin/payouts/:payoutId/proof   any staff: the stored image, nosniff and the strict CSP
 *   GET  /api/admin/payouts/:payoutId/void    admin only: what a void would do, from the server
 *   POST /api/admin/payouts/:payoutId/void    admin only: void with a reason
 *
 * The void paths are in ADMIN_ONLY_PATHS, so the staff gate refuses an employee with 403 before
 * the handler runs, and the command checks the role again. A proof upload is checked cheaply
 * first (a staff session, a payout that exists, is not voided and moved money), then sanitized
 * off the event loop and written to the files directory, then recorded in its transaction, which
 * checks the payout again (no I/O inside `tx`); when the transaction refuses it, the new file is
 * removed. A body over 8 MB is refused by the body limit as `error.proof.too_large`.
 */
import { createHash } from "node:crypto";
import { payoutIdParamsSchema, payoutProofResponseSchema, payoutVoidPreviewSchema, payoutVoidRequestSchema, payoutVoidResponseSchema, type ErrorCode } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { z } from "zod";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { sendImage } from "../../../platform/http/image-response";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import { staffActorOf, type StaffPrincipal } from "../../../platform/ports/staff-session.port";
import type { Actor, CommandAudit } from "../../../platform/ports/audit.port";
import type { OutboxLookup, OutboxPort } from "../../../platform/ports/outbox.port";
import { OrderPayoutError, TransitionError } from "../../orders/index";
import { PROOF_MAX_BYTES, sanitizeProofImage } from "../proof-image";
import { PayoutProofError, proofOf, proofRefusal, recordPayoutProof, type PayoutProofErrorCode, type ProofStore } from "../payout-proof.command";
import { PayoutVoidError, voidPayout, type PayoutVoidErrorCode } from "../payout-void.command";
import { voidPreview } from "../payout-void.query";

export interface PayoutRecordRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
  readonly outbox: (db: LedgerDb, by: CommandAudit) => OutboxPort & OutboxLookup;
  readonly lookup: (db: LedgerDb) => OutboxLookup;
  readonly proofs: ProofStore;
}

const VOID_STATUS: Record<PayoutVoidErrorCode, ErrorCode> = { admin_only: "forbidden", reason_required: "invalid_request", payout_not_found: "not_found" };
const PROOF_STATUS: Record<PayoutProofErrorCode, ErrorCode> = { staff_only: "forbidden", payout_not_found: "not_found", payout_voided: "conflict", proof_not_needed: "conflict" };

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

const payoutIdOf = (params: unknown): number => Number(parsed(payoutIdParamsSchema, params).payoutId);

function inTx<T>(deps: PayoutRecordRouteDeps, staff: StaffPrincipal | null, fn: (db: LedgerDb, by: CommandAudit) => T): T {
  if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  try {
    return deps.ledger.tx((db) => fn(db, deps.audit(db, staffActorOf(staff))));
  } catch (error) {
    if (error instanceof PayoutVoidError) throw new HttpError(VOID_STATUS[error.code], `error.payout.${error.code}`);
    if (error instanceof PayoutProofError) throw new HttpError(PROOF_STATUS[error.code], `error.proof.${error.code}`);
    // A covered order that is no longer PAID: the payout's records disagree, so nothing is voided.
    if (error instanceof TransitionError || error instanceof OrderPayoutError) throw new HttpError("conflict", "error.payout.void_inconsistent");
    throw error;
  }
}

async function uploadProof(deps: PayoutRecordRouteDeps, staff: StaffPrincipal | null, payoutId: number, body: unknown) {
  if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  const refusal = proofRefusal(deps.ledger.db, payoutId);
  if (refusal !== null) throw new HttpError(PROOF_STATUS[refusal], `error.proof.${refusal}`);
  if (!Buffer.isBuffer(body)) throw new HttpError("invalid_request", "error.proof.not_an_image");
  const clean = await sanitizeProofImage(body);
  if (clean.kind === "refused") throw new HttpError("invalid_request", `error.proof.${clean.code}`);
  const fileName = deps.proofs.write(clean.bytes, clean.contentType);
  const file = { fileName, contentType: clean.contentType, byteSize: clean.bytes.length, sha256: createHash("sha256").update(clean.bytes).digest("hex"), width: clean.width, height: clean.height };
  try {
    return inTx(deps, staff, (db, by) => recordPayoutProof(db, { payoutId, file }, { clock: deps.clock, by }));
  } catch (error) {
    deps.proofs.discard(fileName);
    throw error;
  }
}

export function payoutRecordRoutes(deps: PayoutRecordRouteDeps): StaffRoutes {
  const { clock } = deps;
  return (add) => {
    add({
      method: "POST",
      url: "/api/admin/payouts/:payoutId/proof",
      bodyLimit: PROOF_MAX_BYTES,
      tooLargeKey: "error.proof.too_large",
      handler: async (request, _reply, { staff }) => payoutProofResponseSchema.parse(await uploadProof(deps, staff, payoutIdOf(request.params), request.body)),
    });
    add({
      method: "GET",
      url: "/api/admin/payouts/:payoutId/proof",
      handler: async (request, reply) => {
        const payoutId = payoutIdOf(request.params);
        const proof = proofOf(deps.ledger.db, payoutId);
        const bytes = proof === null ? null : deps.proofs.read(proof.fileName);
        if (proof === null || bytes === null) throw new HttpError("not_found", "error.proof.not_found");
        return sendImage(reply, { contentType: proof.contentType, bytes, name: `proof-${payoutId}${proof.contentType === "image/png" ? ".png" : ".jpg"}` });
      },
    });
    add({
      method: "GET",
      url: "/api/admin/payouts/:payoutId/void",
      adminOnly: true,
      handler: async (request) => {
        const db = deps.ledger.db;
        let preview;
        try {
          preview = voidPreview(db, payoutIdOf(request.params), deps.lookup(db));
        } catch (error) {
          if (error instanceof TransitionError || error instanceof OrderPayoutError) throw new HttpError("conflict", "error.payout.void_inconsistent");
          throw error;
        }
        if (preview === null) throw new HttpError("not_found", "error.payout.payout_not_found");
        return payoutVoidPreviewSchema.parse(preview);
      },
    });
    add({
      method: "POST",
      url: "/api/admin/payouts/:payoutId/void",
      adminOnly: true,
      handler: async (request, _reply, { staff }) => {
        const { reason } = parsed(payoutVoidRequestSchema, request.body ?? {});
        const payoutId = payoutIdOf(request.params);
        const voided = inTx(deps, staff, (db, by) => voidPayout(db, { payoutId, reason: reason ?? "" }, { clock, by, outbox: deps.outbox(db, by) }));
        return payoutVoidResponseSchema.parse(voided);
      },
    });
  };
}
