/**
 * The two listeners (AD-18): public (served through the tunnel) and internal
 * (token only, for the assistant and the bridge). Both bind to 127.0.0.1 and
 * `trustProxy` stays off, so a forwarded header never changes who the caller is.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Clock } from "@cashback/core";

import { installErrorEnvelope } from "./error-envelope";
import { registerHealthRoutes } from "./health.routes";
import { requireInternalToken } from "./internal-token.guard";
import { registerStaffRoutes, type StaffGate, type StaffRoutes } from "./staff-routes";

export const LOOPBACK = "127.0.0.1";

export interface ServerDeps {
  clock: Clock;
  internalToken: string;
  /** The shared redacting logger (AD-27); tests leave it out and log nothing. */
  logger?: FastifyBaseLogger;
  /** The admin desk's routes behind Cloudflare Access; absent, no staff route exists (Story 4.2). */
  staff?: { readonly gate: StaffGate; readonly routes: readonly StaffRoutes[] };
}

export interface Servers {
  publicApp: FastifyInstance;
  internalApp: FastifyInstance;
}

function baseApp(logger: FastifyBaseLogger | undefined): FastifyInstance {
  const options = { trustProxy: false, bodyLimit: 64 * 1024 };
  const app: FastifyInstance = logger ? Fastify({ ...options, loggerInstance: logger }) : Fastify({ ...options, logger: false });
  installErrorEnvelope(app);
  return app;
}

export function buildServers(deps: ServerDeps): Servers {
  const publicApp = baseApp(deps.logger);
  registerHealthRoutes(publicApp, deps.clock);
  if (deps.staff) registerStaffRoutes(publicApp, deps.staff.gate, deps.staff.routes);

  const internalApp = baseApp(deps.logger);
  requireInternalToken(internalApp, deps.internalToken);
  internalApp.get("/internal/ping", async () => ({ status: "ok" }));

  return { publicApp, internalApp };
}

export async function listen(servers: Servers, ports: { public: number; internal: number }): Promise<void> {
  await servers.publicApp.listen({ host: LOOPBACK, port: ports.public });
  await servers.internalApp.listen({ host: LOOPBACK, port: ports.internal });
}

export async function close(servers: Servers): Promise<void> {
  await Promise.all([servers.publicApp.close(), servers.internalApp.close()]);
}
