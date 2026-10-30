import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";

/**
 * Runs the periodic jobs. Three rules from the design, all learned from real
 * incidents: a job never overlaps itself, one bad pass never stops the job,
 * and a job that keeps failing tells the owner instead of spinning silently.
 */
export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
  /** Run once at startup too (the notify loop should not wait 10 s). */
  runOnStart?: boolean;
}

export interface JobRunnerDeps {
  enabled: boolean;
  /** Owner alert after repeated failures. Never throws. */
  alert: (text: string) => Promise<unknown>;
  log?: (message: string) => void;
}

/** After this many failed passes in a row, alert — and again every N more. */
const ALERT_AFTER_FAILURES = 3;

export class JobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly jobs: ScheduledJob[],
    private readonly deps: JobRunnerDeps,
  ) {}

  onModuleInit(): void {
    if (!this.deps.enabled) return;
    for (const job of this.jobs) {
      const timer = setInterval(() => void this.tick(job), job.intervalMs);
      timer.unref?.();
      this.timers.push(timer);
      if (job.runOnStart) void this.tick(job);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** Run one job now, honoring the no-overlap and failure rules. */
  async tick(job: ScheduledJob): Promise<void> {
    if (this.running.has(job.name)) return;
    this.running.add(job.name);
    try {
      await job.run();
      this.failures.set(job.name, 0);
    } catch (error) {
      const failures = (this.failures.get(job.name) ?? 0) + 1;
      this.failures.set(job.name, failures);
      this.deps.log?.(`job ${job.name} failed (${failures} in a row): ${String(error)}`);
      if (failures % ALERT_AFTER_FAILURES === 0) {
        await this.deps
          .alert(`⚠️ Job "${job.name}" failed ${failures} times in a row: ${String(error)}`)
          .catch(() => undefined);
      }
    } finally {
      this.running.delete(job.name);
    }
  }
}
