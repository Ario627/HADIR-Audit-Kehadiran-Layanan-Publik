import { Logger } from '@nestjs/common';
import type { ClaimOptions, OutboxJob } from '../db/repositories/outbox.repository';
import { OutboxRepository, isExhausted } from '../db/repositories/outbox.repository';

export type JobHandler = (job: OutboxJob) => Promise<void>;

export interface WorkerOptions extends ClaimOptions {
  pollIntervalMs: number;
}

export interface RunSummary {
  claimed: number;
  completed: number;
  skipped: number;
  failed: number;
}

export const DEFAULT_WORKER_OPTIONS: WorkerOptions = Object.freeze({
  batchSize: 25,
  leaseSeconds: 60,
  maxAttempts: 5,
  pollIntervalMs: 5_000,
});

export function createWorkerOptions(overrides: Partial<WorkerOptions> = {}): WorkerOptions {
  return { ...DEFAULT_WORKER_OPTIONS, ...overrides };
}

export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly handlers: ReadonlyMap<string, JobHandler>,
    private readonly options: WorkerOptions = DEFAULT_WORKER_OPTIONS,
  ) {}

  private async dispatch(job: OutboxJob): Promise<'completed' | 'skipped' | 'failed'> {
    const handler = this.handlers.get(job.topic);
    if (handler === undefined) {
      await this.repository.complete(job.id);
      return 'skipped';
    }
    try {
      await handler(job);
      await this.repository.complete(job.id);
      return 'completed';
    } catch (error) {
      await this.repository.fail(job.id, job.attempts, error);
      const terminal = isExhausted(job.attempts, this.options.maxAttempts);
      const message = error instanceof Error ? error.message : String(error);
      if (terminal) {
        this.logger.error(
          `Job ${job.id} (${job.topic}) habis setelah ${job.attempts} percobaan: ${message}`,
        );
      } else {
        this.logger.warn(
          `Job ${job.id} (${job.topic}) gagal pada percobaan ${job.attempts}: ${message}`,
        );
      }
      return 'failed';
    }
  }

  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = { claimed: 0, completed: 0, skipped: 0, failed: 0 };
    const jobs = await this.repository.claim(this.options);
    summary.claimed = jobs.length;

    for (const job of jobs) {
      const outcome = await this.dispatch(job);
      if (outcome === 'completed') {
        summary.completed += 1;
      } else if (outcome === 'skipped') {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
    }
    return summary;
  }

  async start(): Promise<void> {
    if (this.timer !== null) {
      return;
    }
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped || this.running) {
        return;
      }
      this.running = true;
      try {
        const summary = await this.runOnce();
        if (summary.claimed > 0) {
          this.logger.log(
            `Outbox: klaim ${summary.claimed}, selesai ${summary.completed}, lewati ${summary.skipped}, gagal ${summary.failed}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Outbox poll gagal: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.options.pollIntervalMs);
    this.timer.unref();
    await tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}