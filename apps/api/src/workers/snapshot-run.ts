import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EvidenceService } from '../modules/evidence/evidence.service';

const LIMIT_ENV = Number(process.env.SNAPSHOT_STOP_LIMIT);
const STOP_ENV = process.env.SNAPSHOT_STOP_ID;

async function main(): Promise<void> {
  const logger = new Logger('SnapshotRunner');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const evidence = app.get(EvidenceService);
    if (STOP_ENV !== undefined && STOP_ENV.length > 0) {
      const result = await evidence.refreshSnapshot(STOP_ENV, '7d');
      logger.log(
        `Snapshot halte ${STOP_ENV}: ${result.inserted ? 'baru' : 'sudah ada'}, ${result.inputRows} baris.`,
      );
      return;
    }
    const limit = Number.isFinite(LIMIT_ENV) && LIMIT_ENV > 0 ? LIMIT_ENV : 50;
    const summary = await evidence.refreshSnapshotsForActiveStops(limit);
    logger.log(
      `Snapshot: ${summary.stops} halte aktif, ${summary.inserted} rekaman baru, ${summary.rows} baris observasi.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const logger = new Logger('SnapshotRunner');
  logger.error(
    'Penyusunan snapshot gagal.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
