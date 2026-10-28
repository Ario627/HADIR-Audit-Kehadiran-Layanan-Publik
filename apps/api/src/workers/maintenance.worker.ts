import { Logger } from '@nestjs/common';
import type { ReapWindow } from '../db/repositories/episodes.repository';
import type { PruneOptions } from '../db/repositories/maintenance.repository';
import type { MaintenanceRepository } from '../db/repositories/maintenance.repository';
import { DEFAULT_PRUNE_OPTIONS } from '../db/repositories/maintenance.repository';

export interface MaintenanceOptions {
  intervalMs: number;
  prune: PruneOptions;
  reapWindow: ReapWindow;
  reapLimit: number;
  reapMaxRounds: number;
  runOnStart: boolean;
}

export interface MaintenanceSummary {
  idempotencyRemoved: number;
  episodesReaped: number;
  credentialsRemoved: number;
  failures: number;
}

export const DEFAULT_MAINTENANCE_OPTIONS: MaintenanceOptions = Object.freeze({
  intervalMs: 900_000,
  prune: DEFAULT_PRUNE_OPTIONS,
  reapWindow: { tauMinutes: 45, idleMinutes: 10, maxMinutes: 180 },
  reapLimit: 250,
  reapMaxRounds: 20,
  runOnStart: false,
});

export function createMaintenanceOptions(
  overrides: Partial<MaintenanceOptions> = {},
): MaintenanceOptions {
  return { ...DEFAULT_MAINTENANCE_OPTIONS, ...overrides };
}

export class MaintenanceWorker {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly repository: MaintenanceRepository,
    private readonly options: MaintenanceOptions = DEFAULT_MAINTENANCE_OPTIONS,
  ) {}

  private async pruneIdempotency(): Promise<number> {
    return this.repository.drainIdempotencyKeys(this.options.prune);
  }

  private async reapEpisodes(): Promise<number> {
    return this.repository.drainStaleEpisodes(
      this.options.reapWindow,
      this.options.reapLimit,
      this.options.reapMaxRounds,
    );
  }

  private async pruneCredentials(): Promise<number> {
    return this.repository.drainExpiredCredentials(this.options.prune);
  }

  async runOnce(): Promise<MaintenanceSummary> {
    const summary: MaintenanceSummary = {
      idempotencyRemoved: 0,
      episodesReaped: 0,
      credentialsRemoved: 0,
      failures: 0,
    };

    try {
      summary.idempotencyRemoved = await this.pruneIdempotency();
    } catch (error) {
      summary.failures += 1;
      this.logger.warn(
        `Pembersihan idempotency gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      summary.episodesReaped = await this.reapEpisodes();
    } catch (error) {
      summary.failures += 1;
      this.logger.warn(
        `Sapuan episode basi gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      summary.credentialsRemoved = await this.pruneCredentials();
    } catch (error) {
      summary.failures += 1;
      this.logger.warn(
        `Pembersihan kredensial kedaluwarsa gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (
      summary.idempotencyRemoved > 0 ||
      summary.episodesReaped > 0 ||
      summary.credentialsRemoved > 0
    ) {
      this.logger.log(
        `Pemeliharaan: ${summary.idempotencyRemoved} kunci idempotency, ${summary.episodesReaped} episode ditutup, ${summary.credentialsRemoved} kredensial kedaluwarsa`,
      );
    }

    return summary;
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.schedule();
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(
        `Siklus pemeliharaan gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.options.runOnStart) {
      await this.tick();
      return;
    }
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}