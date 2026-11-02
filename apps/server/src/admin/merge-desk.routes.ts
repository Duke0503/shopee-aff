/**
 * Customer merges on the admin desk (FR-11, FR-36, AD-23, D42; Stories 4.19 and 6.11 after
 * cutover): the proposals after a new Zalo account, the dialog's preview and the merge itself,
 * through the same identity commands and balance composition as the internal CLI. Admin only
 * (ADMIN_ONLY_PATHS).
 *
 *   GET  /api/admin/merges/proposals   pairs to look at (code_claimed, same_name since the latest Zalo switch)
 *   POST /api/admin/merges/preview     both sides as the customer page reads them, and the plan or the refusal
 *   POST /api/admin/merges             apply: re-planned inside the transaction, so it refuses what a fresh preview would
 *
 * The preview answers both sides even when the command refuses (two different bank accounts, a
 * transfer under way), so the dialog can show who would be merged and why it cannot be.
 */
import { customerMergedResponseSchema, customerMergeProposalsSchema, deskMergePreviewSchema, deskMergeRequestSchema, type DeskMergePreview, type DeskMergeSide } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { applyMerge, customerKeys, deskCustomerOf, latestZaloSwitch, mergeProposals, planMerge } from "../modules/identity/index";
import { commandAudit } from "../modules/operations/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRoutes } from "../platform/http/staff-routes";
import { staffActorOf } from "../platform/ports/staff-session.port";
import { balanceOf, mergePreview, openClaimOf, refusal } from "./admin-command.routes";
import { customerPage } from "./customer-desk.routes";

export interface MergeDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

function requestOf(body: unknown) {
  const result = deskMergeRequestSchema.safeParse(body);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

/** One side as the customer page shows it (the same balance, counts and bank); null for a key that is no desk customer. */
function sideOf(db: LedgerDb, key: string, clock: Clock): DeskMergeSide | null {
  const found = deskCustomerOf(db, key);
  if (found === null || found.status === "ERASED") return null;
  const page = customerPage(db, { customerId: found.customerId, keys: customerKeys(db, found.customerId)?.keys ?? [found.customerId] }, clock);
  const { gross, payable, waiting, paid, deductedNext } = page.balance;
  return {
    customerId: page.customerId,
    customerCode: page.customerCode,
    customerName: page.customerName,
    zaloUserId: page.zaloUserId,
    balance: { gross, payable, waiting, paid, deductedNext },
    orders: page.counts.orders,
    linkRequests: page.counts.linkRequests,
    bank: page.bank === null ? null : { bankName: page.bank.bankName, lastFour: page.bank.lastFour },
  };
}

export function deskMergePreview(db: LedgerDb, mergedKey: string, survivorKey: string, clock: Clock): DeskMergePreview {
  const merged = sideOf(db, mergedKey, clock);
  const survivor = sideOf(db, survivorKey, clock);
  if (merged === null || survivor === null) throw new HttpError("not_found", "error.merge.customer_not_found", { customer: merged === null ? mergedKey : survivorKey });
  try {
    const p = mergePreview(db, planMerge(db, mergedKey, survivorKey, openClaimOf(db)));
    return { merged, survivor, plan: { bankMoves: p.bankMoves, result: p.result }, refusal: null };
  } catch (error) {
    const refused = refusal(error);
    if (!(refused instanceof HttpError)) throw error;
    return { merged, survivor, plan: null, refusal: { code: refused.code, messageKey: refused.messageKey, fields: refused.fields ?? {} } };
  }
}

export function mergeDeskRoutes({ ledger, clock }: MergeDeskRouteDeps): StaffRoutes {
  return (add) => {
    add({
      method: "GET",
      url: "/api/admin/merges/proposals",
      adminOnly: true,
      handler: async () => {
        const db = ledger.db;
        const since = latestZaloSwitch(db);
        return customerMergeProposalsSchema.parse({ since, proposals: mergeProposals(db, since) });
      },
    });
    add({
      method: "POST",
      url: "/api/admin/merges/preview",
      adminOnly: true,
      handler: async (request) => {
        const body = requestOf(request.body);
        return deskMergePreviewSchema.parse(ledger.sqlite.transaction(() => deskMergePreview(ledger.db, body.merged, body.survivor, clock)).deferred());
      },
    });
    add({
      method: "POST",
      url: "/api/admin/merges",
      adminOnly: true,
      handler: async (request, _reply, context) => {
        const body = requestOf(request.body);
        if (context.staff === null) throw new HttpError("unauthorized", "error.unauthorized");
        const actor = staffActorOf(context.staff);
        try {
          const done = ledger.tx((db) => {
            const plan = applyMerge(db, planMerge(db, body.merged, body.survivor, openClaimOf(db)), { clock, by: commandAudit(db, clock, actor) });
            return { mergedId: plan.merged.customerId, survivorId: plan.survivor.customerId, bankMoves: plan.bankMoves, balance: balanceOf(db, plan.survivor.customerId) };
          });
          return customerMergedResponseSchema.parse(done);
        } catch (error) {
          throw refusal(error);
        }
      },
    });
  };
}
