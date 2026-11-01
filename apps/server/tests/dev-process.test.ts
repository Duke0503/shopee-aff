/**
 * Story 8.1 AC2: the dev stop script stops only the PID the start script recorded, and only while
 * that PID is still the process started then (AD-25, cashback-infra rule 10); the stop is ordered
 * first and a kill only when the server did not stop (review item 7).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixedClock, systemClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { osProcessProbe, parseEtime, pidFilePath, readPidRecord, stopRecorded, writePidRecord, type GracefulStop, type ProcessProbe } from "../src/platform/lifecycle/dev-process";
import { tempDir } from "./helpers/live-fixture";

const NOW = fixedClock("2026-11-01T03:00:00.000Z");

/** A fake OS: `started` maps a live PID to its seconds since start; `killed` lists what was killed, `exited` what stopped itself. */
function fakeOs(started: Record<number, number>): ProcessProbe & { killed: number[]; exited: number[] } {
  const killed: number[] = [];
  const exited: number[] = [];
  return {
    killed,
    exited,
    isAlive: (pid) => pid in started && !killed.includes(pid) && !exited.includes(pid),
    elapsedSeconds: (pid) => started[pid] ?? null,
    kill: (pid) => void killed.push(pid),
  };
}

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill();
});

function sleeper(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  return new Promise((resolve) => child.once("spawn", () => resolve(child)));
}

function recorded(pid = 4242): string {
  const path = pidFilePath(tempDir("cashback-run-"));
  writePidRecord(path, { pid, startedAt: "2026-11-01T02:59:00.000Z" });
  return path;
}

const graceful = (request: () => Promise<boolean>): GracefulStop => ({ request, waitMs: 200, pollMs: 10 });

describe("Story 8.1 AC2: the stop script stops only the PIDs it recorded", () => {
  it("AC2: the recorded server stops itself through its ordered stop; nothing is killed", async () => {
    const path = recorded();
    const os = fakeOs({ 4242: 60, 777: 3600 });
    const asked: number[] = [];
    expect(await stopRecorded(path, os, NOW, graceful(async () => (asked.push(1), os.exited.push(4242), true)))).toEqual({ outcome: "stopped", pid: 4242 });
    expect([asked, os.killed]).toEqual([[1], []]);
    expect(existsSync(path)).toBe(false);
  });

  it("review 7: a server that does not stop in time, refuses the request or cannot be reached is killed and reported forced", async () => {
    for (const request of [async () => true, async () => false, async () => Promise.reject(new Error("ECONNREFUSED"))]) {
      const os = fakeOs({ 4242: 60, 777: 3600 });
      expect(await stopRecorded(recorded(), os, NOW, graceful(request))).toEqual({ outcome: "forced", pid: 4242 });
      expect(os.killed).toEqual([4242]);
    }
    const os = fakeOs({ 4242: 60 });
    expect(await stopRecorded(recorded(), os, NOW)).toEqual({ outcome: "forced", pid: 4242 });
  });

  it("AC2: a recorded PID the OS has given to another process is left running and never asked to stop", async () => {
    const os = fakeOs({ 4242: 7200 });
    let asked = false;
    expect(await stopRecorded(recorded(), os, NOW, graceful(async () => (asked = true)))).toEqual({ outcome: "not_ours", pid: 4242 });
    expect([os.killed, asked]).toEqual([[], false]);
  });

  it("AC2: with no record, a dead PID, an unreadable record or an unknown start time nothing is stopped", async () => {
    const dir = tempDir("cashback-run-");
    const os = fakeOs({ 4242: 60 });
    expect(await stopRecorded(pidFilePath(dir), os, NOW)).toEqual({ outcome: "nothing_recorded", pid: null });
    writePidRecord(pidFilePath(dir), { pid: 5151, startedAt: "2026-11-01T02:59:00.000Z" });
    expect(await stopRecorded(pidFilePath(dir), os, NOW)).toEqual({ outcome: "not_running", pid: 5151 });
    writePidRecord(pidFilePath(dir), { pid: 4242, startedAt: "2026-11-01T02:59:00.000Z" });
    expect(await stopRecorded(pidFilePath(dir), { ...os, elapsedSeconds: () => null }, NOW)).toEqual({ outcome: "not_ours", pid: 4242 });
    expect(os.killed).toEqual([]);
    expect(readPidRecord(join(dir, "missing.pid"))).toBeNull();
  });

  it("AC2: on this OS, of two running processes only the recorded one is stopped", async () => {
    const mine = await sleeper();
    const stranger = await sleeper();
    const path = pidFilePath(tempDir("cashback-run-"));
    writePidRecord(path, { pid: mine.pid ?? 0, startedAt: systemClock.now() });
    const exited = new Promise((resolve) => mine.once("exit", resolve));
    expect(await stopRecorded(path, osProcessProbe, systemClock)).toEqual({ outcome: "forced", pid: mine.pid });
    await exited;
    expect(osProcessProbe.isAlive(stranger.pid ?? 0)).toBe(true);
  }, 30_000);

  it("reads ps elapsed times", () => {
    expect(parseEtime("05:07")).toBe(307);
    expect(parseEtime(" 2-03:04:05\n")).toBe(2 * 86_400 + 3 * 3_600 + 4 * 60 + 5);
    expect(parseEtime("garbage")).toBeNull();
  });
});
