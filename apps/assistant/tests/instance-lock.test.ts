/**
 * Production 2026-11-02: two assistants on one Zalo account kicked each other off. The assistant
 * takes its instance lock before it opens the Zalo session, and a second one of the same
 * environment finds it held and exits. The Windows lock (production) is checked on this OS's real
 * files when it is Windows; both rules are checked with fake OS calls everywhere. No Zalo, no
 * second process.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireInstanceLock, instanceLockPath, NODE_LOCK_FILES, UV_FS_O_EXLOCK, type LockFiles } from "../src/instance-lock";

const dir = (): string => mkdtempSync(join(tmpdir(), "cashback-assistant-lock-"));
const error = (code: string): Error => Object.assign(new Error(code), { code });

/** Files in memory; `openBy` says which open fails with which OS error. */
function fakeFiles(platform: NodeJS.Platform, over: Partial<LockFiles> = {}): LockFiles & { files: Map<string, string>; closed: number[]; flags: number[] } {
  const files = new Map<string, string>();
  const closed: number[] = [];
  const flags: number[] = [];
  const fds = new Map<number, string>();
  let next = 10;
  return {
    files,
    closed,
    flags,
    platform,
    pid: 4242,
    open: (path, f) => {
      flags.push(f);
      fds.set(next, path);
      return next++;
    },
    write: (fd, text) => void files.set(fds.get(fd) as string, text),
    close: (fd) => void closed.push(fd),
    read: (path) => files.get(path) ?? null,
    remove: (path) => void files.delete(path),
    isAlive: () => false,
    ...over,
  };
}

describe("production 2026-11-02: one assistant per environment", () => {
  it("the lock lives in the assistant's own data folder, one per environment", () => {
    expect(instanceLockPath(join("data", "prod", "assistant"))).toBe(join("data", "prod", "assistant", "assistant.lock"));
  });

  it.runIf(process.platform === "win32")("on Windows a second take of the real lock file is refused while the first is held, and allowed once it is released", () => {
    const path = instanceLockPath(dir());
    const first = acquireInstanceLock(path);
    expect(first).not.toBeNull();
    expect(acquireInstanceLock(path)).toBeNull();
    first?.release();
    first?.release();
    const second = acquireInstanceLock(path);
    expect(second).not.toBeNull();
    second?.release();
  });

  it("on Windows the file is opened with no sharing, and a sharing violation means another assistant holds it", () => {
    const files = fakeFiles("win32");
    const lock = acquireInstanceLock("C:\\data\\assistant.lock", files);
    expect(lock).not.toBeNull();
    expect((files.flags[0] as number) & UV_FS_O_EXLOCK).toBe(UV_FS_O_EXLOCK);
    expect(files.files.get("C:\\data\\assistant.lock")).toBe("4242\n");
    lock?.release();
    expect(files.closed).toEqual([10]);
    expect(acquireInstanceLock("C:\\data\\assistant.lock", fakeFiles("win32", { open: () => { throw error("EBUSY"); } }))).toBeNull();
    expect(() => acquireInstanceLock("C:\\data\\assistant.lock", fakeFiles("win32", { open: () => { throw error("ENOENT"); } }))).toThrow("ENOENT");
  });

  it("elsewhere the file holds the PID: a live holder refuses the start, a dead one's file is taken over", () => {
    const busy = fakeFiles("linux", { open: () => { throw error("EEXIST"); }, isAlive: (pid) => pid === 7000 });
    busy.files.set("/d/assistant.lock", "7000\n");
    expect(acquireInstanceLock("/d/assistant.lock", busy)).toBeNull();

    const files = fakeFiles("linux");
    let opens = 0;
    const real = files.open;
    files.files.set("/d/assistant.lock", "7000\n");
    const stale = { ...files, open: (path: string, f: number) => (opens++ === 0 ? (() => { throw error("EEXIST"); })() : real(path, f)) };
    const lock = acquireInstanceLock("/d/assistant.lock", stale);
    expect(lock).not.toBeNull();
    expect(files.files.get("/d/assistant.lock")).toBe("4242\n");
    lock?.release();
    expect(files.files.has("/d/assistant.lock")).toBe(false);
  });

  it("the entry takes the lock before it opens the Zalo session, and exits without opening it when the lock is held", () => {
    const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
    const taken = main.indexOf("acquireInstanceLock(instanceLockPath(config.dataDir))");
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(main.indexOf("openZaloSession("));
    expect(main.slice(taken, main.indexOf("openZaloSession("))).toMatch(/if \(lock === null\) \{[\s\S]*assistant\.process\.already_running[\s\S]*return;/);
    expect(NODE_LOCK_FILES.platform).toBe(process.platform);
  });
});
