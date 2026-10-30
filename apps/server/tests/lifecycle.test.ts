import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";

import { stopServer } from "../src/platform/lifecycle/shutdown";
import { acquireServerLock, lockFilePath } from "../src/platform/lock/server-lock";
import { createLogger } from "../src/platform/log/logger";
import { randomPort, sandbox, startServer } from "./helpers/server-process";

const TOKEN = "t".repeat(40);

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("startup failure (review item 7)", () => {
  it("a port already in use logs platform.server.start_failed, releases the lock and exits 1", async () => {
    const port = randomPort();
    const blocker = await occupy(port);
    try {
      const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${port}`, `INTERNAL_PORT=${randomPort()}`]);
      const server = startServer(box);
      expect(await server.exited).toBe(1);
      expect(server.output()).toContain('"msg":"platform.server.start_failed"');
      expect(server.output()).toContain("EADDRINUSE");
      expect(server.output()).not.toContain("platform.server.started");
      const lock = acquireServerLock(lockFilePath(box.dataDir));
      expect(lock).not.toBeNull();
      lock?.release();
    } finally {
      blocker.close();
    }
  }, 30_000);
});

describe("shutdown (review item 7)", () => {
  function parts(closeFails: boolean) {
    const calls: string[] = [];
    const lines: string[] = [];
    return {
      calls,
      lines,
      parts: {
        closeServers: async () => {
          calls.push("servers");
          if (closeFails) throw new Error("close failed");
        },
        ledger: { close: () => void calls.push("ledger") },
        lock: { release: () => void calls.push("lock") },
        logger: createLogger({ destination: { write: (line: string) => void lines.push(line) } }),
      },
    };
  }

  it("closes the servers, then the ledger, then releases the lock, and returns 0", async () => {
    const { calls, lines, parts: p } = parts(false);
    expect(await stopServer(p, "SIGTERM")).toBe(0);
    expect(calls).toEqual(["servers", "ledger", "lock"]);
    expect(lines.join("")).toContain("platform.server.stopped");
  });

  it("still closes the ledger and releases the lock when closing the servers fails, and returns 1", async () => {
    const { calls, lines, parts: p } = parts(true);
    expect(await stopServer(p, "SIGTERM")).toBe(1);
    expect(calls).toEqual(["servers", "ledger", "lock"]);
    expect(lines.join("")).toContain("platform.server.stop_failed");
  });

  it("releases the lock even when closing the ledger throws", async () => {
    const { calls, parts: p } = parts(false);
    const failing = {
      ...p,
      ledger: {
        close: () => {
          calls.push("ledger");
          throw new Error("ledger close failed");
        },
      },
    };
    expect(await stopServer(failing, "SIGINT")).toBe(1);
    expect(calls).toEqual(["servers", "ledger", "lock"]);
  });
});

describe("shutdown with jobs (Story 3.1 AC4)", () => {
  it("stops the jobs before the servers, the ledger and the lock", async () => {
    const calls: string[] = [];
    const logger = createLogger({ destination: { write: () => undefined } });
    const p = {
      jobs: { stop: async () => (calls.push("jobs"), { finished: true, stillRunning: [] }) },
      closeServers: async () => void calls.push("servers"),
      ledger: { close: () => void calls.push("ledger") },
      lock: { release: () => void calls.push("lock") },
      logger,
    };
    expect(await stopServer(p, "SIGTERM")).toBe(0);
    expect(calls).toEqual(["jobs", "servers", "ledger", "lock"]);
  });

  it("returns 1 and names the job when a run outlived the timeout, and still closes everything", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const p = {
      jobs: { stop: async () => ({ finished: false, stillRunning: ["reconcile"] }) },
      closeServers: async () => void calls.push("servers"),
      ledger: { close: () => void calls.push("ledger") },
      lock: { release: () => void calls.push("lock") },
      logger: createLogger({ destination: { write: (line: string) => void lines.push(line) } }),
    };
    expect(await stopServer(p, "SIGTERM")).toBe(1);
    expect(calls).toEqual(["servers", "ledger", "lock"]);
    expect(lines.join("")).toContain('"stillRunning":["reconcile"]');
  });
});
