import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import type { ReapWindow } from './episodes.repository';
import type { EpisodesRepository } from './episodes.repository';

export interface PruneOptions {
  graceSeconds: number;
  batchSize: number;
  maxRounds: number;
}

export const DEFAULT_PRUNE_OPTIONS: PruneOptions = Object.freeze({
  graceSeconds: 3_600,
  batchSize: 500,
  maxRounds: 20,
});

export class MaintenanceRepository {
  constructor(
    private readonly db: Database,
    private readonly episodes: EpisodesRepository,
  ) {}

  async pruneIdempotencyKeys(graceSeconds: number, limit: number): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT prune_idempotency_keys(${graceSeconds}, ${limit}) AS removed`,
    );
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const value = row.removed;
    if (typeof value === 'number') {
      return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async drainIdempotencyKeys(options: PruneOptions = DEFAULT_PRUNE_OPTIONS): Promise<number> {
    let total = 0;
    for (let round = 0; round < options.maxRounds; round += 1) {
      const removed = await this.pruneIdempotencyKeys(options.graceSeconds, options.batchSize);
      total += removed;
      if (removed < options.batchSize) {
        return total;
      }
    }
    return total;
  }

  async drainStaleEpisodes(window: ReapWindow, limit: number, maxRounds: number): Promise<number> {
    let total = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const reaped = await this.episodes.reapStaleGlobal(window, limit);
      total += reaped.length;
      if (reaped.length < limit) {
        return total;
      }
    }
    return total;
  }
}