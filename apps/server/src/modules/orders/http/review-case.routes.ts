/**
 * Review case routes on the admin desk (FR-14, Stories 3.9 and 4.2). Any staff role may preview,
 * apply or dismiss (FR-24); the commands check the role again, so the route is not the only
 * guard. Apply and dismiss are one transaction each with their history, audit and outbox rows;
 * preview only reads, over a plain handle and read-only ports, and takes no write lock. A refusal maps to
 * the error envelope with the command's own code in the message key.
 */
import {
  reviewApplyRequestSchema,
  reviewCaseIdSchema,
  reviewDismissRequestSchema,
  reviewOutcomeResponseSchema,
  reviewPreviewResponseSchema,
  type ErrorCode,
} from "@cashback/contracts";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { Actor } from "../../../platform/ports/audit.port";
import { staffActorOf, type StaffPrincipal } from "../../../platform/ports/staff-session.port";
import type { ApplyDeps } from "../report-apply.command";
import { applyReviewCase, dismissReviewCase } from "../review-apply.command";
import { previewReviewApply, ReviewCaseError, type ReviewCaseErrorCode, type ReviewReadDeps } from "../review-plan.query";

export interface ReviewCaseRouteDeps {
  readonly ledger: Ledger;
  /** The command's ports bound to one transaction's handle, for this staff actor. */
  readonly applyDeps: (db: LedgerDb, actor: Actor) => ApplyDeps;
  /** The read-only context a preview needs, over a plain handle: no writer, no transaction. */
  readonly readDeps: (actor: Actor) => ReviewReadDeps;
}

const STATUS_OF: Partial<Record<ReviewCaseErrorCode, ErrorCode>> = { staff_only: "forbidden", reason_missing: "invalid_request", case_not_found: "not_found" };

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

function actorOf(staff: StaffPrincipal | null): Actor {
  if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  return staffActorOf(staff);
}

function refusalsMapped<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ReviewCaseError) throw new HttpError(STATUS_OF[error.code] ?? "conflict", `error.review_case.${error.code}`);
    throw error;
  }
}

/** A write: one transaction with the command's ports bound to it. */
function inTx<T>(deps: ReviewCaseRouteDeps, staff: StaffPrincipal | null, fn: (db: LedgerDb, d: ApplyDeps) => T): T {
  const actor = actorOf(staff);
  return refusalsMapped(() => deps.ledger.tx((db) => fn(db, deps.applyDeps(db, actor))));
}

const caseIdOf = (request: FastifyRequest): number => parsed(reviewCaseIdSchema, request.params).caseId;

export function reviewCaseRoutes(deps: ReviewCaseRouteDeps): StaffRoutes {
  return (add) => {
    add({
      method: "POST",
      url: "/api/admin/review-cases/:caseId/preview",
      handler: async (request, _reply, { staff }) => {
        const body = parsed(reviewApplyRequestSchema, request.body);
        const caseId = caseIdOf(request);
        const actor = actorOf(staff);
        return reviewPreviewResponseSchema.parse(refusalsMapped(() => previewReviewApply(deps.ledger.db, { ...body, caseId }, deps.readDeps(actor))));
      },
    });
    add({
      method: "POST",
      url: "/api/admin/review-cases/:caseId/apply",
      handler: async (request, _reply, { staff }) => {
        const body = parsed(reviewApplyRequestSchema, request.body);
        const caseId = caseIdOf(request);
        return reviewOutcomeResponseSchema.parse(inTx(deps, staff, (db, d) => applyReviewCase(db, { ...body, caseId }, d)));
      },
    });
    add({
      method: "POST",
      url: "/api/admin/review-cases/:caseId/dismiss",
      handler: async (request, _reply, { staff }) => {
        const body = parsed(reviewDismissRequestSchema, request.body);
        const caseId = caseIdOf(request);
        return reviewOutcomeResponseSchema.parse(inTx(deps, staff, (db, d) => dismissReviewCase(db, { ...body, caseId }, d)));
      },
    });
  };
}
