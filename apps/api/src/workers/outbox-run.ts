import { Logger } from '@nestjs/common';
import { closeDatabase, db } from '../db/client';
import { OutboxRepository } from '../db/repositories/outbox.repository';
import { OutboxWorker, createWorkerOptions } from './outbox.worker';

const POLL_ENV = Number(process.env.OUTBOX_POLL_MS);
const BATCH_ENV = Number(process.env.OUTBOX_BATCH_SIZE);

async function main(): Promise<void> {
  const logger = new Logger('OutboxRunner');
  const repository = new OutboxRepository(db);
  const options = createWorkerOptions({
    ...(Number.isFinite(POLL_ENV) && POLL_ENV > 0 ? { pollIntervalMs: POLL_ENV } : {}),
    ...(Number.isFinite(BATCH_ENV) && BATCH_ENV > 0 ? { batchSize: BATCH_ENV } : {}),
  });
  const worker = new OutboxWorker(repository, new Map(), options);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Menerima ${signal}; menghentikan worker.`);
    await worker.stop();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log(
    `Outbox worker berjalan: batch ${options.batchSize}, poll ${options.pollIntervalMs}ms, lease ${options.leaseSeconds}s`,
  );
  await worker.start();
  await new Promise(() => undefined);
}

main().catch((error: unknown) => {
  const logger = new Logger('OutboxRunner');
  logger.error(
    'Outbox worker gagal dimulai.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});