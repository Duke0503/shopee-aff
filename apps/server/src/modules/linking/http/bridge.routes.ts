/**
 * The browser bridge's routes (AD-14, AD-18, INV-7; Story 5.3), on the internal listener only:
 *
 *   GET  /internal/bridge/next      `X-Bridge-Token`, `X-Bridge-Instance`: the next job (200), or 204 when the server-side wait ends
 *   POST /internal/bridge/results   `X-Bridge-Token`, `X-Bridge-Instance`: one answer, by its job's ticket
 *
 * Both are marked as the bridge's, so the listener's token guard checks the bridge token for them
 * and no other token opens them. A call without a well-formed instance id is refused (400). The
 * poll is held on the server (the extension never waits in a page) and is let go when the bridge
 * hangs up or the server stops, so a stop never waits out a poll. A job that does not meet the
 * contract when it is handed out is answered `bad_job` for that job and the poll answers 204: a
 * broken job never fails the poll, so it can never block the line. An answer nobody waits on is
 * accepted as false.
 */
import { BRIDGE_INSTANCE_HEADER, BRIDGE_INSTANCE_PATTERN, BRIDGE_NEXT_PATH, BRIDGE_RESULTS_PATH, bridgeJobSchema, bridgeResultAcceptedSchema, bridgeResultSchema } from "@cashback/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { HttpError } from "../../../platform/http/error-envelope";
import { BRIDGE_ROUTE } from "../../../platform/http/internal-token.guard";
import type { BridgeWorkQueue } from "../../../platform/ports/bridge.port";

export interface BridgeRouteDeps {
  readonly work: BridgeWorkQueue;
}

function instanceOf(request: FastifyRequest): string {
  const instance = request.headers[BRIDGE_INSTANCE_HEADER];
  if (typeof instance !== "string" || !BRIDGE_INSTANCE_PATTERN.test(instance)) throw new HttpError("invalid_request", "error.invalid_request");
  return instance;
}

export function bridgeInternalRoutes(deps: BridgeRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    const held = new Set<AbortController>();
    app.addHook("preClose", async () => {
      for (const poll of held) poll.abort();
    });
    app.get(BRIDGE_NEXT_PATH, { config: BRIDGE_ROUTE }, async (request, reply) => {
      const instance = instanceOf(request);
      const hangUp = new AbortController();
      held.add(hangUp);
      reply.raw.once("close", () => hangUp.abort());
      const job = await deps.work.next(instance, hangUp.signal).finally(() => held.delete(hangUp));
      if (job === null) return reply.code(204).send();
      const checked = bridgeJobSchema.safeParse(job);
      if (checked.success) return checked.data;
      request.log.warn({ ticket: job.ticket }, "linking.bridge.bad_job");
      deps.work.deliver({ ticket: job.ticket, outcome: "failed", reason: "bad_job" }, instance);
      return reply.code(204).send();
    });

    app.post(BRIDGE_RESULTS_PATH, { config: BRIDGE_ROUTE }, async (request) => {
      const instance = instanceOf(request);
      const body = bridgeResultSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      return bridgeResultAcceptedSchema.parse({ accepted: deps.work.deliver(body.data, instance) });
    });
  };
}
