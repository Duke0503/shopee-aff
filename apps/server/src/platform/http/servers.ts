/**
 * The two listeners (AD-18): public (served through the tunnel) and internal
 * (token only, for the assistant, the bridge and the admin CLI). Both bind to 127.0.0.1 and
 * `trustProxy` stays off, so a forwarded header never changes who the caller is. The public
 * listener also answers on ::1, the IPv6 loopback, on the same port: the tunnel's route names
 * `localhost`, which Windows may resolve to ::1 first (cutover of 2026-11-02). Never on 0.0.0.0
 * or ::. A machine without IPv6 skips that second bind with a warning; a port taken on ::1 fails.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Clock } from "@cashback/core";

import { installErrorEnvelope } from "./error-envelope";
import { registerHealthRoutes } from "./health.routes";
import { requireInternalToken } from "./internal-token.guard";
import { registerStaffRoutes, type StaffGate, type StaffRoutes } from "./staff-routes";

export const LOOPBACK = "127.0.0.1";
export const LOOPBACK_V6 = "::1";

/** The ::1 listener of each started public app, closed with it. */
const v6Listeners = new WeakMap<Servers, Server>();

const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

/** Hands every request on ::1 to the public app, so both loopbacks serve the same routes. */
async function listenV6(servers: Servers, port: number): Promise<void> {
  const v6 = createServer((request, response) => void servers.publicApp.server.emit("request", request, response));
  try {
    await new Promise<void>((resolve, reject) => {
      v6.once("error", reject);
      v6.listen({ host: LOOPBACK_V6, port, ipv6Only: true }, () => resolve());
    });
    v6Listeners.set(servers, v6);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && NO_IPV6.has(code)) servers.publicApp.log.warn({ code }, "platform.http.ipv6_loopback_absent");
    else throw error;
  }
}

export interface ServerDeps {
  clock: Clock;
  internalToken: string;
  /** The Zalo assistant's token for its routes (AD-15); absent, those routes answer 401. */
  assistantToken?: string | null;
  /** The browser bridge's token for its routes (Story 5.3); absent, those routes answer 401. */
  bridgeToken?: string | null;
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
  requireInternalToken(internalApp, { internal: deps.internalToken, assistant: deps.assistantToken ?? null, bridge: deps.bridgeToken ?? null });
  internalApp.get("/internal/ping", async () => ({ status: "ok" }));
  for (const add of deps.internal ?? []) add(internalApp);

  return { publicApp, internalApp };
}

export async function listen(servers: Servers, ports: { public: number; internal: number }): Promise<void> {
  await servers.publicApp.listen({ host: LOOPBACK, port: ports.public });
  await listenV6(servers, (servers.publicApp.server.address() as AddressInfo).port);
  await servers.internalApp.listen({ host: LOOPBACK, port: ports.internal });
}

/** Where the public listener answers, for the checks: 127.0.0.1 and, with IPv6, ::1. */
export function publicAddresses(servers: Servers): AddressInfo[] {
  const v6 = v6Listeners.get(servers);
  return [servers.publicApp.server.address() as AddressInfo, ...(v6 ? [v6.address() as AddressInfo] : [])];
}

export async function close(servers: Servers): Promise<void> {
  const v6 = v6Listeners.get(servers);
  v6Listeners.delete(servers);
  const v6Closed = v6 === undefined ? Promise.resolve() : new Promise<void>((resolve) => v6.close(() => resolve()));
  v6?.closeAllConnections();
  await Promise.all([servers.publicApp.close(), servers.internalApp.close(), v6Closed]);
}
