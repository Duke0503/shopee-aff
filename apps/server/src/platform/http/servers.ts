/**
 * The two listeners (AD-18): public (served through the tunnel) and internal
 * (token only, for the assistant, the bridge and the admin CLI). Both bind to 127.0.0.1 and
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
  /** Routes on the internal listener, behind its token (the admin commands of Story 4.20). */
  internal?: readonly InternalRoutes[];
  /** Public routes on the public listener: the server pages and the signed-in customer's reads (Story 4.9). */
  public?: readonly PublicRoutes[];
}

/** Adds public routes; each checks its own customer session where it needs one. */
export type PublicRoutes = (app: FastifyInstance) => void;

/** Adds routes to the internal listener; its token check already runs before each of them. */
export type InternalRoutes = (app: FastifyInstance) => void;

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
  for (const add of deps.public ?? []) add(publicApp);
  if (deps.staff) registerStaffRoutes(publicApp, deps.staff.gate, deps.staff.routes);

  const internalApp = baseApp(deps.logger);
  requireInternalToken(internalApp, deps.internalToken);
  internalApp.get("/internal/ping", async () => ({ status: "ok" }));
  for (const add of deps.internal ?? []) add(internalApp);

  return { publicApp, internalApp };
}

export async function listen(servers: Servers, ports: { public: number; internal: number }): Promise<void> {
  await servers.publicApp.listen({ host: LOOPBACK, port: ports.public });
  await servers.internalApp.listen({ host: LOOPBACK, port: ports.internal });
}

export async function close(servers: Servers): Promise<void> {
  await Promise.all([servers.publicApp.close(), servers.internalApp.close()]);
}
