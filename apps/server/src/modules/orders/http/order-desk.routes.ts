/**
 * The orders module's desk routes (FR-13, FR-26, FR-37, D54; Stories 4.13 and 4.18). Any staff
 * role may use them (FR-24).
 *
 *   GET  /api/admin/orders                                              the Orders list on the list contract; read only
 *   GET  /api/admin/settlement-periods                                  the withheld setting of each period the screen shows
 *   GET  /api/admin/settlement-periods/:network/:periodMonth/impact     ?withheld=: how many orders that setting would reach
 *   POST /api/admin/settlement-periods/:network/:periodMonth            mark the period withheld or not, recorded with the staff member
 *
 * There is no route that changes an order: an order is paid only by a payout confirm (list-defects
 * Orders, `OrdersView.tsx:716`).
 */
import { adminOrdersResponseSchema, settlementPeriodImpactQuerySchema, settlementPeriodImpactSchema, settlementPeriodMarkSchema, settlementPeriodParamsSchema, settlementPeriodSchema, settlementPeriodsResponseSchema, type ErrorCode } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { z } from "zod";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { Actor, CommandAudit } from "../../../platform/ports/audit.port";
import { staffActorOf } from "../../../platform/ports/staff-session.port";
import { answerOrdersList } from "../orders.list";
import { markSettlementPeriod, SettlementPeriodError, type SettlementPeriodErrorCode } from "../settlement-period.command";
import { settlementPeriodImpact, settlementPeriodRows } from "../settlement-period.query";

export interface OrderDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
}

const PERIOD_STATUS: Record<SettlementPeriodErrorCode, ErrorCode> = { invalid_period: "invalid_request", always_withheld: "conflict" };

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

export function orderDeskRoutes(deps: OrderDeskRouteDeps): StaffRoutes {
  const { ledger, clock } = deps;
  return (add) => {
    add({ method: "GET", url: "/api/admin/orders", handler: async (request) => adminOrdersResponseSchema.parse(answerOrdersList(ledger.db, request.query, clock)) });
    add({ method: "GET", url: "/api/admin/settlement-periods", handler: async () => settlementPeriodsResponseSchema.parse(settlementPeriodRows(ledger.db, clock)) });
    add({
      method: "GET",
      url: "/api/admin/settlement-periods/:network/:periodMonth/impact",
      handler: async (request) => {
        const { network, periodMonth } = parsed(settlementPeriodParamsSchema, request.params);
        const withheld = parsed(settlementPeriodImpactQuerySchema, request.query).withheld === "true";
        return settlementPeriodImpactSchema.parse({ network, periodMonth, withheld, affected: settlementPeriodImpact(ledger.db, network, periodMonth, withheld, clock) });
      },
    });
    add({
      method: "POST",
      url: "/api/admin/settlement-periods/:network/:periodMonth",
      handler: async (request, _reply, { staff }) => {
        if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
        const { network, periodMonth } = parsed(settlementPeriodParamsSchema, request.params);
        const { withheld } = parsed(settlementPeriodMarkSchema, request.body ?? {});
        try {
          ledger.tx((db) => markSettlementPeriod(db, { network, periodMonth, withheld }, deps.audit(db, staffActorOf(staff))));
        } catch (error) {
          if (error instanceof SettlementPeriodError) throw new HttpError(PERIOD_STATUS[error.code], `error.settlement_period.${error.code}`);
          throw error;
        }
        const row = settlementPeriodRows(ledger.db, clock).periods.find((p) => p.network === network && p.periodMonth === periodMonth);
        return settlementPeriodSchema.parse(row);
      },
    });
  };
}
