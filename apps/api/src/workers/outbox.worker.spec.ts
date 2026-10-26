import type { ClaimOptions, OutboxJob, OutboxRepository } from '../db/repositories/outbox.repository';
import { backoffSeconds, isExhausted } from '../db/repositories/outbox.repository';
import {
  OutboxWorker,
  createWorkerOptions,
  type WorkerOptions,
} from './outbox.worker';

function job(id: string, topic: string, attempts = 1): OutboxJob {
  return { id, topic, payload: {}, attempts };
}

interface RepositoryLog {
  claimed: number;
  completed: string[];
  failed: { id: string; attempts: number; message: string }[];
}

function repositoryDouble(
  jobs: OutboxJob[],
  log: RepositoryLog,
): OutboxRepository {
  return {
    claim: async (_options: ClaimOptions) => {
      log.claimed += 1;
      return jobs;
    },
    complete: async (id: string) => {
      log.completed.push(id);
    },
    fail: async (id: string, attempts: number, error: unknown) => {
      log.failed.push({
        id,
        attempts,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    stats: async () => ({ pending: 0, exhausted: 0, oldestPendingSeconds: null }),
  } as unknown as OutboxRepository;
}

function freshLog(): RepositoryLog {
  return { claimed: 0, completed: [], failed: [] };
}

function options(overrides: Partial<WorkerOptions> = {}): WorkerOptions {
  return createWorkerOptions({ batchSize: 10, pollIntervalMs: 1_000_000, ...overrides });
}

describe('backoffSeconds', () => {
  it('doubles from one attempt', () => {
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(2)).toBe(4);
    expect(backoffSeconds(5)).toBe(32);
  });

  it('caps the ceiling', () => {
    expect(backoffSeconds(9)).toBe(300);
    expect(backoffSeconds(40)).toBe(300);
  });

  it('falls back to one second for invalid input', () => {
    expect(backoffSeconds(0)).toBe(1);
    expect(backoffSeconds(-3)).toBe(1);
    expect(backoffSeconds(Number.NaN)).toBe(1);
  });
});

describe('isExhausted', () => {
  it('treats the max attempt as terminal', () => {
    expect(isExhausted(4, 5)).toBe(false);
    expect(isExhausted(5, 5)).toBe(true);
    expect(isExhausted(6, 5)).toBe(true);
  });
});

describe('OutboxWorker.runOnce', () => {
  it('completes jobs that have a handler', async () => {
    const log = freshLog();
    const handled: string[] = [];
    const worker = new OutboxWorker(
      repositoryDouble([job('a', 'episode.started')], log),
      new Map([['episode.started', async (item: OutboxJob) => {
        handled.push(item.id);
      }]]),
      options(),
    );

    const summary = await worker.runOnce();

    expect(handled).toEqual(['a']);
    expect(log.completed).toEqual(['a']);
    expect(summary).toEqual({ claimed: 1, completed: 1, skipped: 0, failed: 0 });
  });

  it('skips jobs whose topic has no handler but still drains them', async () => {
    const log = freshLog();
    const worker = new OutboxWorker(
      repositoryDouble([job('a', 'unknown.topic')], log),
      new Map(),
      options(),
    );

    const summary = await worker.runOnce();

    expect(log.completed).toEqual(['a']);
    expect(log.failed).toEqual([]);
    expect(summary).toMatchObject({ skipped: 1, completed: 0 });
  });

  it('records a failure and keeps the job pending', async () => {
    const log = freshLog();
    const worker = new OutboxWorker(
      repositoryDouble([job('a', 'episode.ended', 2)], log),
      new Map([['episode.ended', async () => {
        throw new Error('connector down');
      }]]),
      options(),
    );

    const summary = await worker.runOnce();

    expect(log.failed).toEqual([{ id: 'a', attempts: 2, message: 'connector down' }]);
    expect(log.completed).toEqual([]);
    expect(summary).toMatchObject({ failed: 1 });
  });

  it('still schedules backoff on the final attempt', async () => {
    const log = freshLog();
    const worker = new OutboxWorker(
      repositoryDouble([job('a', 'episode.ended', 5)], log),
      new Map([['episode.ended', async () => {
        throw new Error('tetap gagal');
      }]]),
      options({ maxAttempts: 5 }),
    );

    await worker.runOnce();

    expect(log.failed[0]?.attempts).toBe(5);
  });

  it('continues processing the batch after one failure', async () => {
    const log = freshLog();
    const worker = new OutboxWorker(
      repositoryDouble([job('a', 'x'), job('b', 'y'), job('c', 'x')], log),
      new Map([['x', async (item: OutboxJob) => {
        if (item.id === 'a') {
          throw new Error('gagal');
        }
      }]]),
      options(),
    );

    const summary = await worker.runOnce();

    expect(summary).toEqual({ claimed: 3, completed: 1, skipped: 1, failed: 1 });
    expect(log.completed).toEqual(['b', 'c']);
  });

  it('returns zeros when there is nothing to claim', async () => {
    const log = freshLog();
    const worker = new OutboxWorker(repositoryDouble([], log), new Map(), options());

    const summary = await worker.runOnce();

    expect(summary).toEqual({ claimed: 0, completed: 0, skipped: 0, failed: 0 });
    expect(log.claimed).toBe(1);
  });
});