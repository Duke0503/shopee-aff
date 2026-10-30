import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { acquireServerLock, lockFilePath } from "../src/platform/lock/server-lock";
import { randomPort, sandbox, startServer, waitFor, type RunningServer } from "./helpers/server-process";

const TOKEN = "t".repeat(40);

describe("single-instance lock, in process (AD-13)", () => {
  it("refuses a second holder and frees the lock on release", () => {
    const path = lockFilePath(join(mkdtempSync(join(tmpdir(), "cashback-lock-")), "data", "dev"));
    const first = acquireServerLock(path);
    expect(first).not.toBeNull();
    expect(acquireServerLock(path)).toBeNull();
    first?.release();
    const again = acquireServerLock(path);
    expect(again).not.toBeNull();
    again?.release();
  });
});

describe("single-instance lock, across processes (Story 1.5 AC2, AC3)", () => {
  const box = sandbox([`INTERNAL_TOKEN=${TOKEN}`, `PUBLIC_PORT=${randomPort()}`, `INTERNAL_PORT=${randomPort()}`]);
  const running: RunningServer[] = [];
  const start = (): RunningServer => {
    const server = startServer(box);
    running.push(server);
    return server;
  };

  afterAll(() => {
    for (const server of running) if (server.child.exitCode === null) server.child.kill("SIGKILL");
  });

  let first: RunningServer;

  it("AC2: a second instance on the same data directory refuses to start and logs platform.server.lock_held", async () => {
    first = start();
    await waitFor(first, "platform.server.started");
    expect(existsSync(lockFilePath(box.dataDir))).toBe(true);

    const second = start();
    expect(await second.exited).toBe(1);
    expect(second.output()).toContain('"msg":"platform.server.lock_held"');
    expect(second.output()).not.toContain("platform.server.started");
  }, 60_000);

  it("AC3: after a crash leaves the lock file behind, the server starts again", async () => {
    first.child.kill("SIGKILL");
    await first.exited;
    expect(existsSync(lockFilePath(box.dataDir))).toBe(true);

    const restarted = start();
    await waitFor(restarted, "platform.server.started");
    expect(restarted.output()).not.toContain("platform.server.lock_held");
  }, 60_000);
});
