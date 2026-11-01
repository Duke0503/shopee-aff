/**
 * A graceful stop over the internal listener (Story 8.1 review item 7, AD-25). On Windows a
 * signal ends a process at once, skipping the ordered shutdown (jobs, listeners, ledger, lock), so
 * `pnpm dev:stop` asks the dev server to stop itself here first. The route sits behind the
 * internal token like every internal route, on 127.0.0.1 only, and the composition root registers
 * it in dev only. The stop starts once the answer is sent.
 */
import type { FastifyInstance } from "fastify";

export const SHUTDOWN_PATH = "/internal/shutdown";

export function shutdownRoutes(requestStop: () => void): (app: FastifyInstance) => void {
  return (app) => {
    app.post(SHUTDOWN_PATH, async (_request, reply) => {
      reply.raw.once("finish", requestStop);
      return reply.code(202).send({ status: "stopping" });
    });
  };
}
