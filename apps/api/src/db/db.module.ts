import {
  Global,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  assertDatabasePrivileges,
  checkDatabase,
  closeDatabase,
  db,
  poolStats,
  withTransaction,
  type DatabaseHealth,
  type PoolStats,
} from './client';
import { TRANSACTION_RUNNER } from './transaction-runner';

export const DATABASE = Symbol('DATABASE');

@Injectable()
export class DbHealthService {
  private readonly logger = new Logger(DbHealthService.name);

  async check(): Promise<DatabaseHealth> {
    try {
      return await checkDatabase();
    } catch (error) {
      this.logger.warn(
        `Database health check gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, latencyMs: -1 };
    }
  }

  stats(): PoolStats {
    return poolStats();
  }
}

@Injectable()
export class DbLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DbLifecycle.name);

  async onModuleInit(): Promise<void> {
    await assertDatabasePrivileges();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeDatabase();
    this.logger.log('PostgreSQL pool ditutup');
  }
}

@Global()
@Module({
  providers: [
    DbHealthService,
    DbLifecycle,
    { provide: DATABASE, useValue: db },
    { provide: TRANSACTION_RUNNER, useValue: withTransaction },
  ],
  exports: [DATABASE, DbHealthService, TRANSACTION_RUNNER],
})
export class DbModule {}