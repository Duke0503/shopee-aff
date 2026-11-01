/**
 * Story 5.3, extension side: the loop takes one job at a time, never waits for work itself (the
 * server holds the poll), and keeps going through a server restart. The server is a scripted fake.
 */
import type { BridgeJob, BridgeResult } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { jobWorker, POST_TRIES, RETRY_MAX_MS, runBridgeLoop, type Answer, type LoopDeps } from "../src/bridge-loop";
import type { ConnectedSettings } from "../src/bridge-settings";
import type { Poll, ServerClient } from "../src/server-client";
import { fakePage, recordingWait } from "./fakes";

const SETTINGS: ConnectedSettings = { serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40), instance: "a".repeat(32) };
const ticket = (n: number) => n.toString(16).padStart(32, "0");
const linkJob = (n: number): BridgeJob => ({ ticket: ticket(n), kind: "link", sourceUrl: "https://shopee.vn/x-i.1.2", subId1: "DEV1000000000000000001", subId2: `DEV2611010000${n}`, timeoutMs: 90_000 });

type Step = Poll | "down" | "end";

/** A server that answers each poll from the script, then ends the loop. */
function scriptedServer(steps: Step[], postFailures = 0) {
  const events: string[] = [];
  const posted: BridgeResult[] = [];
  const stop = { stopped: false };
  let failuresLeft = postFailures;
  const client: ServerClient = {
    next: async () => {
      events.push("poll");
      const step = steps.shift() ?? "end";
      if (step === "end") {
        stop.stopped = true;
        return { kind: "idle" };
      }
      if (step === "down") throw new TypeError("fetch failed");
      return step;
    },
    post: async (result) => {
      if (failuresLeft-- > 0) throw new TypeError("fetch failed");
      events.push(`post ${result.ticket.slice(-1)} ${result.outcome}`);
      posted.push(result);
      return true;
    },
  };
  return { client, events, posted, stop };
}

function deps(server: ReturnType<typeof scriptedServer>, work: (job: BridgeJob) => Promise<Answer>, wait = recordingWait()): LoopDeps & { wait: ReturnType<typeof recordingWait>; logs: string[] } {
  const logs: string[] = [];
  return { loadSettings: async () => SETTINGS, client: () => server.client, work, wait, log: (event) => void logs.push(event), logs };
}

describe("Story 5.3: the extension takes one job at a time", () => {
  it("AC1: it works one job to its answer before it polls again, so only one job is ever in hand", async () => {
    const server = scriptedServer([{ kind: "job", job: linkJob(1) }, { kind: "job", job: linkJob(2) }]);
    let inHand = 0;
    let most = 0;
    const work = async (job: BridgeJob): Promise<Answer> => {
      inHand++;
      most = Math.max(most, inHand);
      server.events.push(`work ${job.ticket.slice(-1)}`);
      await Promise.resolve();
      inHand--;
      return { outcome: "link", url: "https://s.shopee.vn/A" };
    };
    expect(await runBridgeLoop(deps(server, work), server.stop)).toBe("stopped");
    expect(server.events).toEqual(["poll", "work 1", "post 1 link", "poll", "work 2", "post 2 link", "poll"]);
    expect(most).toBe(1);
    expect(server.posted.map((r) => r.ticket)).toEqual([ticket(1), ticket(2)]);
  });

  it("AC1: a lookup or report page job is answered unsupported, never worked on the page, until Stories 5.6 and 5.9", async () => {
    const page = fakePage();
    const work = jobWorker(page, recordingWait());
    expect(await work({ ticket: ticket(1), kind: "lookup", url: "https://shopee.vn/x", timeoutMs: 90_000 })).toEqual({ outcome: "failed", reason: "unsupported" });
    expect(await work({ ticket: ticket(2), kind: "report", page: 1, timeoutMs: 90_000 })).toEqual({ outcome: "failed", reason: "unsupported" });
    expect(page.calls).toEqual([]);
  });

  it("AC2: after an empty poll it polls again at once; it never waits for work itself", async () => {
    const server = scriptedServer([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }]);
    const d = deps(server, async () => ({ outcome: "failed", reason: "no_link" }));
    await runBridgeLoop(d, server.stop);
    expect(server.events).toEqual(["poll", "poll", "poll", "poll"]);
    expect(d.wait.calls).toEqual([]);
  });

  it("survives a server restart: an unreachable server is retried with a growing pause, then polling goes on", async () => {
    const steps: Step[] = [...Array<Step>(8).fill("down"), { kind: "job", job: linkJob(1) }];
    const server = scriptedServer(steps);
    const d = deps(server, async () => ({ outcome: "link", url: "https://s.shopee.vn/A" }));
    await runBridgeLoop(d, server.stop);
    expect(d.wait.calls).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    expect(server.posted).toHaveLength(1);
    expect(d.logs.filter((l) => l === "bridge.server.unreachable")).toHaveLength(8);
  });

  it("an answer that cannot be posted is retried, then dropped (the server gives the job out again); a work error is answered script_error", async () => {
    const server = scriptedServer([{ kind: "job", job: linkJob(1) }], POST_TRIES - 1);
    await runBridgeLoop(deps(server, async () => Promise.reject(new Error("tab closed"))), server.stop);
    expect(server.posted).toEqual([{ ticket: ticket(1), outcome: "failed", reason: "script_error" }]);

    const lost = scriptedServer([{ kind: "job", job: linkJob(2) }], POST_TRIES);
    const d = deps(lost, async () => ({ outcome: "link", url: "https://s.shopee.vn/A" }));
    await runBridgeLoop(d, lost.stop);
    expect(lost.posted).toEqual([]);
    expect(d.logs).toContain("bridge.result.dropped");
  });

  it("ends without settings or with a refused token, for the keep-alive alarm to start it again", async () => {
    const server = scriptedServer([{ kind: "unauthorized" }]);
    expect(await runBridgeLoop(deps(server, async () => ({ outcome: "failed", reason: "no_link" })), server.stop)).toBe("unauthorized");
    const none = scriptedServer([]);
    expect(await runBridgeLoop({ ...deps(none, async () => ({ outcome: "failed", reason: "no_link" })), loadSettings: async () => null }, none.stop)).toBe("no_settings");
    expect(none.events).toEqual([]);
  });
});
