import { JobQueue, type BridgeJob, type JobResult } from "./job-queue";

/**
 * The state the server keeps for the Chrome extension. Ports the core of
 * `shopee/browser_bridge.py`: a queue of jobs, the set of live extension
 * instances, and the handshake between `/execute` (which waits) and the
 * extension's `/result/<id>` (which answers).
 */
export const LIVE_WINDOW_MS = 45_000;

export interface BridgeOptions {
  token: string;
  hosts: string[];
  landingUrl: string;
}

export interface BridgeStatus {
  ok: boolean;
  connected: boolean;
  instances: number;
  queued_jobs: number;
}

export class Bridge {
  readonly token: string;
  readonly hosts: string[];
  readonly landingUrl: string;

  private readonly queue = new JobQueue();
  private readonly instances = new Map<string, number>();
  private readonly waiters = new Map<string, (result: JobResult) => void>();

  constructor(options: BridgeOptions) {
    this.token = options.token;
    this.hosts = options.hosts;
    this.landingUrl = options.landingUrl;
  }

  touch(uuid: string, nowMs: number): void {
    this.instances.set(uuid, nowMs);
  }

  private liveCount(nowMs: number): number {
    let live = 0;
    for (const seen of this.instances.values()) {
      if (nowMs - seen <= LIVE_WINDOW_MS) live += 1;
    }
    return live;
  }

  status(nowMs: number): BridgeStatus {
    const instances = this.liveCount(nowMs);
    return { ok: true, connected: instances > 0, instances, queued_jobs: this.queue.pendingCount() };
  }

  nextJob(nowMs: number, leaseMs: number): BridgeJob | null {
    return this.queue.leaseNext(nowMs, leaseMs);
  }

  /** Answer a waiting `/execute`. Returns false when nobody is waiting. */
  deliver(jobId: string, result: JobResult): boolean {
    const waiter = this.waiters.get(jobId);
    if (!waiter) return false;
    if (result.ok) this.queue.complete(jobId, result.value);
    else this.queue.fail(jobId, result.error ?? "failed");
    this.waiters.delete(jobId);
    waiter(result);
    return true;
  }

  /** Enqueue a job and wait for the extension to answer, or time out. */
  submit(job: BridgeJob, timeoutMs: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      this.queue.add(job);
      const timer = setTimeout(() => {
        this.waiters.delete(job.id);
        reject(new Error(`bridge job ${job.id} timed out`));
      }, timeoutMs);
      this.waiters.set(job.id, (result) => {
        clearTimeout(timer);
        if (result.ok) resolve(result.value);
        else reject(new Error(result.error ?? "bridge job failed"));
      });
    });
  }
}
