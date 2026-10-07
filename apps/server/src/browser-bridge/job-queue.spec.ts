import { describe, expect, it } from "vitest";
import { JobQueue, type BridgeJob } from "./job-queue";

const job = (id: string): BridgeJob => ({ id, action: "click", params: { selector: "#go" } });

describe("JobQueue leases", () => {
  it("hands a job out once, then nothing until its lease expires", () => {
    const queue = new JobQueue();
    queue.add(job("j1"));
    expect(queue.leaseNext(0, 120_000)?.id).toBe("j1");
    expect(queue.leaseNext(0, 120_000)).toBeNull();
  });

  it("hands a job out again after the lease runs out", () => {
    const queue = new JobQueue();
    queue.add(job("j1"));
    queue.leaseNext(0, 120_000);
    expect(queue.leaseNext(120_000, 120_000)?.id).toBe("j1"); // lease expired
  });

  it("removes a completed job and records its result once", () => {
    const queue = new JobQueue();
    queue.add(job("j1"));
    queue.leaseNext(0, 120_000);
    queue.complete("j1", { clicked: true });
    expect(queue.pendingCount()).toBe(0);
    expect(queue.result("j1")).toEqual({ ok: true, value: { clicked: true } });
    expect(queue.leaseNext(0, 120_000)).toBeNull();
  });

  it("records a failure", () => {
    const queue = new JobQueue();
    queue.add(job("j1"));
    queue.leaseNext(0, 120_000);
    queue.fail("j1", "no tab");
    expect(queue.result("j1")).toEqual({ ok: false, error: "no tab" });
  });

  it("serves jobs in order", () => {
    const queue = new JobQueue();
    queue.add(job("j1"));
    queue.add(job("j2"));
    expect(queue.leaseNext(0, 120_000)?.id).toBe("j1");
    expect(queue.leaseNext(0, 120_000)?.id).toBe("j2");
  });
});
