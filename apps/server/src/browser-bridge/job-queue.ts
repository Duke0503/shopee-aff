/**
 * The queue the server hands jobs to the Chrome extension through.
 * Ports the lease behaviour of `shopee/browser_bridge.py`:
 *
 *   - a job is handed out ONCE and leased for a while
 *   - if the extension dies, the lease runs out and the job is handed out again
 *   - a completed or failed job is removed and its result recorded once
 *
 * Pure and in-memory: no timer, no socket. The clock is passed in.
 */
export interface BridgeJob {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

export interface JobResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Entry {
  job: BridgeJob;
  leasedUntilMs: number | null;
}

export class JobQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly results = new Map<string, JobResult>();

  add(job: BridgeJob): void {
    this.entries.set(job.id, { job, leasedUntilMs: null });
  }

  /** Hand out the next free job, leasing it until `nowMs + leaseMs`. */
  leaseNext(nowMs: number, leaseMs: number): BridgeJob | null {
    this.releaseExpired(nowMs);
    for (const entry of this.entries.values()) {
      if (entry.leasedUntilMs === null) {
        entry.leasedUntilMs = nowMs + leaseMs;
        return entry.job;
      }
    }
    return null;
  }

  complete(jobId: string, value: unknown): void {
    this.results.set(jobId, { ok: true, value });
    this.entries.delete(jobId);
  }

  fail(jobId: string, error: string): void {
    this.results.set(jobId, { ok: false, error });
    this.entries.delete(jobId);
  }

  result(jobId: string): JobResult | null {
    return this.results.get(jobId) ?? null;
  }

  pendingCount(): number {
    return this.entries.size;
  }

  /** Free any job whose lease has run out, so it can be handed out again. */
  private releaseExpired(nowMs: number): void {
    for (const entry of this.entries.values()) {
      if (entry.leasedUntilMs !== null && entry.leasedUntilMs <= nowMs) {
        entry.leasedUntilMs = null;
      }
    }
  }
}
