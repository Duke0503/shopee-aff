/**
 * Network payouts in and out (FR-19, D59, AD-18; Story 4.21).
 *
 *   POST /internal/network-payouts                     internal listener only, internal token: record one network payout
 *   GET  /api/admin/network-settlements                staff: the network payouts tab, on the list contract
 *   GET  /api/admin/network-settlements/:settlementId  staff: one payout with its orders, matched total and difference
 *
 * A network payout is reported by the operator's machine (the browser bridge reading the
 * network's payout record page, or an export), never typed on the desk: the record route lives
 * on the internal listener, runs as the system actor `network-sync` and writes in one
 * transaction. Staff only read.
 */
import { networkPayoutRecordResponseSchema, networkPayoutRecordSchema, networkSettlementDetailSchema, networkSettlementListSchema, networkSettlementParamsSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { Actor, CommandAudit } from "../../../platform/ports/audit.port";
import { NetworkSettlementError, recordNetworkPayout } from "../network-settlement.command";
import { answerNetworkSettlements, networkSettlementDetail } from "../network-settlement.list";

export const NETWORK_SYNC_ACTOR: Actor = { kind: "system", id: "network-sync" };

export interface NetworkPayoutRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
}

export function networkPayoutInternalRoutes(deps: NetworkPayoutRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post("/internal/network-payouts", async (request) => {
      const body = networkPayoutRecordSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      try {
        return networkPayoutRecordResponseSchema.parse(deps.ledger.tx((db) => recordNetworkPayout(db, body.data, { clock: deps.clock, by: deps.audit(db, NETWORK_SYNC_ACTOR) })));
      } catch (error) {
        if (error instanceof NetworkSettlementError) throw new HttpError("conflict", `error.network_payout.${error.code}`);
        throw error;
      }
    });
  };
}

export function networkSettlementRoutes(deps: Pick<NetworkPayoutRouteDeps, "ledger" | "clock">): StaffRoutes {
  return (add) => {
    add({ method: "GET", url: "/api/admin/network-settlements", handler: async (request) => networkSettlementListSchema.parse(answerNetworkSettlements(deps.ledger.db, request.query, deps.clock)) });
    add({
      method: "GET",
      url: "/api/admin/network-settlements/:settlementId",
      handler: async (request) => {
        const params = networkSettlementParamsSchema.safeParse(request.params);
        if (!params.success) throw new HttpError("invalid_request", "error.invalid_request");
        const detail = networkSettlementDetail(deps.ledger.db, Number(params.data.settlementId));
        if (detail === null) throw new HttpError("not_found", "error.network_payout.not_found");
        return networkSettlementDetailSchema.parse(detail);
      },
    });
  };
}
