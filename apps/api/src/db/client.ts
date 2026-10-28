import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../common/config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export type ReadScope = 'none' | 'public' | 'citizen' | 'partner' | 'admin';

export interface TransactionContext {
  requestId?: string;
  deviceHash?: string;
  userId?: string;
  institutionId?: string;
  scope?: ReadScope;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function transactionScope(context: TransactionContext): ReadScope {
  if (context.scope !== undefined) {
    return context.scope;
  }
  if (context.userId !== undefined) {
    return 'partner';
  }
  if (context.deviceHash !== undefined) {
    return 'citizen';
  }
  return 'none';
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${field} tidak valid untuk konteks database.`);
  }
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
    options: '-c timezone=UTC -c app.scope=none',
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

export async function configureTransaction(
  tx: Transaction,
  context: TransactionContext = {},
): Promise<void> {
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
  if (context.userId !== undefined) {
    assertUuid(context.userId, 'userId');
    await tx.execute(sql`SELECT set_config('app.user_id', ${context.userId}, true)`);
  }
  if (context.institutionId !== undefined) {
    assertUuid(context.institutionId, 'institutionId');
    await tx.execute(
      sql`SELECT set_config('app.institution_id', ${context.institutionId}, true)`,
    );
  }
  await tx.execute(
    sql`SELECT set_config('app.scope', ${transactionScope(context)}, true)`,
  );
}

export async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
  context: TransactionContext = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await configureTransaction(tx, context);
    return callback(tx);
  });
}

export async function assertDatabasePrivileges(): Promise<void> {
  if (!env.isProduction) {
    return;
  }
  const result = await pool.query<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
  }>(
    'SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  const role = result.rows[0];
  if (!role) {
    throw new Error('Role database aplikasi tidak ditemukan.');
  }
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls) {
    throw new Error(
      'DATABASE_URL memakai role dengan hak istimewa. Gunakan role aplikasi least-privilege.',
    );
  }
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