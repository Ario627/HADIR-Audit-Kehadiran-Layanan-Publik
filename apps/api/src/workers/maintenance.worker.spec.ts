import type { ReapWindow, ReapedEpisode } from '../db/repositories/episodes.repository';
import type { MaintenanceRepository, PruneOptions } from '../db/repositories/maintenance.repository';
import { MaintenanceWorker, createMaintenanceOptions } from './maintenance.worker';

const WINDOW: ReapWindow = { tauMinutes: 45, idleMinutes: 10, maxMinutes: 180 };
const PRUNE: PruneOptions = { graceSeconds: 3_600, batchSize: 4, maxRounds: 3 };

function episode(id: string): ReapedEpisode {
  return {
    id,
    startedAt: new Date('2026-10-26T08:00:00.000Z'),
    endedAt: new Date('2026-10-26T08:20:00.000Z'),
    durationS: 1_200,
  };
}

interface Harness {
  pruneCalls: number;
  reapCalls: number;
}

interface Behaviour {
  prune?: (call: number) => number;
  reap?: (call: number) => ReapedEpisode[];
  failPrune?: boolean;
  failReap?: boolean;
}

function buildRepository(harness: Harness, behaviour: Behaviour = {}): MaintenanceRepository {
  return {
    drainIdempotencyKeys: async (options: PruneOptions) => {
      let total = 0;
      for (let round = 0; round < options.maxRounds; round += 1) {
        harness.pruneCalls += 1;
        if (behaviour.failPrune === true) {
          throw new Error('prune down');
        }
        const removed = behaviour.prune?.(harness.pruneCalls) ?? options.batchSize;
        total += removed;
        if (removed < options.batchSize) {
          return total;
        }
      }
      return total;
    },
    drainStaleEpisodes: async (_window: ReapWindow, limit: number, maxRounds: number) => {
      let total = 0;
      for (let round = 0; round < maxRounds; round += 1) {
        harness.reapCalls += 1;
        if (behaviour.failReap === true) {
          throw new Error('reap down');
        }
        const rows =
          behaviour.reap?.(harness.reapCalls) ??
          Array.from({ length: limit }, (_, index) => episode(`e${harness.reapCalls}-${index}`));
        total += rows.length;
        if (rows.length < limit) {
          return total;
        }
      }
      return total;
    },
  } as unknown as MaintenanceRepository;
}

function buildWorker(harness: Harness, behaviour: Behaviour = {}): MaintenanceWorker {
  return new MaintenanceWorker(
    buildRepository(harness, behaviour),
    createMaintenanceOptions({ prune: PRUNE, reapWindow: WINDOW, reapLimit: 2, reapMaxRounds: 3 }),
  );
}

describe('MaintenanceWorker', () => {
  it('drains until a short batch is observed', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    const summary = await buildWorker(harness, { prune: () => 1 }).runOnce();

    expect(harness.pruneCalls).toBe(1);
    expect(summary.idempotencyRemoved).toBe(1);
    expect(summary.failures).toBe(0);
  });

  it('accumulates full batches up to the round budget', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    const summary = await buildWorker(harness, { prune: () => 4 }).runOnce();

    expect(harness.pruneCalls).toBe(PRUNE.maxRounds);
    expect(summary.idempotencyRemoved).toBe(PRUNE.maxRounds * PRUNE.batchSize);
  });

  it('never exceeds the reap round budget', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    await buildWorker(harness).runOnce();

    expect(harness.reapCalls).toBe(3);
  });

  it('counts a failing task without aborting the other', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    const summary = await buildWorker(harness, {
      failPrune: true,
      reap: () => [episode('a')],
    }).runOnce();

    expect(summary.failures).toBe(1);
    expect(summary.idempotencyRemoved).toBe(0);
    expect(summary.episodesReaped).toBe(1);
  });

  it('records a reap failure separately', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    const summary = await buildWorker(harness, { failReap: true, prune: () => 0 }).runOnce();

    expect(summary.failures).toBe(1);
    expect(summary.episodesReaped).toBe(0);
  });

  it('stays idle after stop', async () => {
    const harness: Harness = { pruneCalls: 0, reapCalls: 0 };
    const worker = buildWorker(harness);
    await worker.stop();
    await worker.start();

    expect(harness.pruneCalls).toBe(0);
    expect(harness.reapCalls).toBe(0);
  });
});