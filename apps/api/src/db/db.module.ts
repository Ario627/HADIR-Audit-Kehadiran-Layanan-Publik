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
  type Database,
  type DatabaseHealth,
  type PoolStats,
} from './client';

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
  ],
  exports: [DATABASE, DbHealthService],
})
export class DbModule {}