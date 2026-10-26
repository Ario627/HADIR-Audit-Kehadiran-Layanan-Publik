import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../common/config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface TransactionContext {
  requestId?: string;
  deviceHash?: string;
}

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

const logger = new Logger('Database');

function sslFor(mode: typeof env.DB_SSL_MODE, ca: string | null): PoolConfig['ssl'] {
  if (mode === 'disable') {
    return false;
  }
  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true, ...(ca === null ? {} : { ca }) };
}

function createPool(): Pool {
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    application_name: env.DB_APPLICATION_NAME,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    lock_timeout: env.DB_LOCK_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    maxUses: 7_500,
    maxLifetimeSeconds: 1_800,
    allowExitOnIdle: false,
    options: '-c timezone=UTC',
    ssl: sslFor(env.DB_SSL_MODE, env.dbSslCa),
  };
  const pool = new Pool(config);
  pool.on('error', (error) => {
    logger.error(`PostgreSQL pool error: ${error.message}`);
  });
  return pool;
}

export const pool = createPool();

export const db: Database = drizzle(pool, { schema });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
  context: TransactionContext = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(env.DB_STATEMENT_TIMEOUT_MS)}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('idle_in_transaction_session_timeout', ${String(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS)}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('lock_timeout', ${String(env.DB_LOCK_TIMEOUT_MS)}, true)`,
    );
    if (context.requestId !== undefined) {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(context.requestId)) {
        throw new Error('requestId tidak valid untuk konteks database.');
      }
      await tx.execute(
        sql`SELECT set_config('app.request_id', ${context.requestId}, true)`,
      );
    }
    if (context.deviceHash !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(context.deviceHash)) {
        throw new Error('deviceHash tidak valid untuk konteks database.');
      }
      await tx.execute(
        sql`SELECT set_config('app.device_hash', ${context.deviceHash}, true)`,
      );
    }
    return callback(tx);
  });
}

export async function checkDatabase(): Promise<DatabaseHealth> {
  const started = performance.now();
  await pool.query('SELECT 1');
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}

export function poolStats(): PoolStats {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}