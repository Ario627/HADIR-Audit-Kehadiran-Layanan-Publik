import { Logger } from '@nestjs/common';
import { env } from '../common/config/env';
import { closeDatabase, db } from '../db/client';
import { EpisodesRepository } from '../db/repositories/episodes.repository';
import { MaintenanceRepository } from '../db/repositories/maintenance.repository';
import { MaintenanceWorker, createMaintenanceOptions } from './maintenance.worker';

const INTERVAL_ENV = Number(process.env.MAINTENANCE_INTERVAL_MS);
const REAP_LIMIT_ENV = Number(process.env.MAINTENANCE_REAP_LIMIT);

async function main(): Promise<void> {
  const logger = new Logger('MaintenanceRunner');
  const episodes = new EpisodesRepository(db);
  const repository = new MaintenanceRepository(db, episodes);
  const options = createMaintenanceOptions({
    runOnStart: true,
    reapWindow: {
      tauMinutes: env.episodeTauMinutes,
      idleMinutes: env.episodeIdleMinutes,
      maxMinutes: env.episodeMaxMinutes,
    },
    ...(Number.isFinite(INTERVAL_ENV) && INTERVAL_ENV >= 60_000
      ? { intervalMs: INTERVAL_ENV }
      : {}),
    ...(Number.isFinite(REAP_LIMIT_ENV) && REAP_LIMIT_ENV > 0 ? { reapLimit: REAP_LIMIT_ENV } : {}),
  });
  const worker = new MaintenanceWorker(repository, options);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Menerima ${signal}; menghentikan worker pemeliharaan.`);
    await worker.stop();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log(
    `Worker pemeliharaan berjalan: interval ${options.intervalMs}ms, sapuan ${options.reapLimit}/ronde`,
  );
  await worker.start();
  await new Promise(() => undefined);
}

main().catch((error: unknown) => {
  const logger = new Logger('MaintenanceRunner');
  logger.error(
    'Worker pemeliharaan gagal dimulai.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});