/**
 * The proof image for the signed-in customer (AD-21, D49, INV-5, INV-13; Story 4.9): on the
 * public listener, `GET /api/me/payouts/:payoutId/proof` answers only to the customer session
 * cookie of the payout's own customer. Without one, with a staff cookie, with another customer's
 * session or for a payout without a proof, it is the same 404 as any missing route, so the URL
 * says nothing about which payouts exist. The image goes out with its stored content type,
 * nosniff and the strict CSP.
 */
import { payoutIdParamsSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import type { Ledger } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { sendImage } from "../../../platform/http/image-response";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../../../platform/http/session-cookie";
import { customerSessionOf } from "../../identity/index";
import { customerProofOf, type ProofStore } from "../payout-proof.command";

export interface CustomerProofRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly proofs: ProofStore;
}

const missing = (): HttpError => new HttpError("not_found", "error.not_found");

export function customerProofRoutes(deps: CustomerProofRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.get("/api/me/payouts/:payoutId/proof", async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const params = payoutIdParamsSchema.safeParse(request.params);
      if (!params.success) throw missing();
      const db = deps.ledger.db;
      const customerId = customerSessionOf(db, readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE), deps.clock);
      if (customerId === null) throw missing();
      const payoutId = Number(params.data.payoutId);
      const proof = customerProofOf(db, payoutId, customerId);
      const bytes = proof === null ? null : deps.proofs.read(proof.fileName);
      if (proof === null || bytes === null) throw missing();
      return sendImage(reply, { contentType: proof.contentType, bytes, name: `proof-${payoutId}${proof.contentType === "image/png" ? ".png" : ".jpg"}` });
    });
  };
}
