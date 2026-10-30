import Fastify, { type FastifyInstance } from "fastify";

import { Bridge } from "./bridge";
import type { BridgeJob } from "./job-queue";

const DEFAULT_JOB_TIMEOUT_MS = 300_000;
const LEASE_MS = 120_000;

export interface BridgeServerDeps {
  now?: () => number;
}

/**
 * The loopback HTTP bridge the Chrome extension polls. Every route needs the
 * `X-Bridge-Token`; the port is opened on 127.0.0.1 only, never the network.
 */
export function createBridgeServer(bridge: Bridge, deps: BridgeServerDeps = {}): FastifyInstance {
  const now = deps.now ?? ((): number => Date.now());
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (request, reply) => {
    if ((request.headers["x-bridge-token"] ?? "") !== bridge.token) {
      await reply.code(401).send({ error: "bad token" });
    }
  });

  app.get("/status", async () => bridge.status(now()));

  app.get("/job", async (_request, reply) => {
    const job = bridge.nextJob(now(), LEASE_MS);
    if (!job) return reply.code(204).send();
    return { id: job.id, connector: bridge.hosts[0] ?? "", action: job.action, params: job.params };
  });

  app.post("/register", async (request) => {
    const uuid = (request.body as { uuid?: string } | undefined)?.uuid;
    if (uuid) bridge.touch(uuid, now());
    return { ok: true };
  });

  app.post("/heartbeat", async (request) => {
    const uuid = (request.body as { uuid?: string } | undefined)?.uuid;
    if (uuid) bridge.touch(uuid, now());
    return { ok: true };
  });

  app.post("/result/:jobId", async (request) => {
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { ok?: boolean; value?: unknown; error?: string };
    const delivered = bridge.deliver(jobId, {
      ok: body.ok ?? true,
      value: body.value,
      error: body.error,
    });
    return { delivered };
  });

  app.post("/execute", async (request, reply) => {
    const body = (request.body ?? {}) as {
      action?: string;
      params?: Record<string, unknown>;
      timeout_ms?: number;
    };
    const job: BridgeJob = {
      id: `job-${now()}-${Math.floor(Math.random() * 1_000_000)}`,
      action: body.action ?? "execute_script",
      params: body.params ?? {},
    };
    const timeoutMs = body.timeout_ms ?? DEFAULT_JOB_TIMEOUT_MS;
    try {
      const value = await bridge.submit(job, timeoutMs + 10_000);
      return { ok: true, value };
    } catch (error) {
      return reply.code(500).send({ ok: false, error: (error as Error).message });
    }
  });

  return app;
}
