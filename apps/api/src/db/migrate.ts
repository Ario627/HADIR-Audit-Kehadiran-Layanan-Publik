import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client, type ClientConfig } from "pg";
import { env } from "../common/config/env";

const MIGRATIONS_DIR = resolve(process.cwd(), 'src/db/migrations');
const LEDGER_TABLE = 'schema_migrations';
const LOCK_NAME = "current_database() || ':hadir-migrations'";
const ADVISORY_LOCK_SQL = `SELECT pg_advisory_lock(hashtext(${LOCK_NAME})::bigint)`;
const ADVISORY_UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtext(${LOCK_NAME})::bigint)`;

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sslFor(): ClientConfig['ssl'] {
  if (env.DB_SSL_MODE === 'disable') {
    return false;
  }
  if (env.DB_SSL_MODE === 'require') {
    return { rejectUnauthorized: false };
  }
  return {
    rejectUnauthorized: true,
    ...(env.dbSslCa === null ? {} : { ca: env.dbSslCa }),
  };
}

function createClient(): Client {
  return new Client({
    connectionString: env.migrationDatabaseUrl ?? env.DATABASE_URL,
    application_name: `${env.DB_APPLICATION_NAME}-migrator`,
    statement_timeout: env.DB_MIGRATION_TIMEOUT_MS,
    query_timeout: env.DB_MIGRATION_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    ssl: sslFor(),
  });
}

async function listMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigration(client: Client, file: string): Promise<boolean> {
  const path = resolve(MIGRATIONS_DIR, file);
  const body = await readFile(path, 'utf8');
  const hash = checksum(body);
  const existing = await client.query<{ checksum: string }>(
    `SELECT checksum FROM ${LEDGER_TABLE} WHERE version = $1`,
    [file],
  );
  if (existing.rowCount === 1) {
    const appliedChecksum = existing.rows[0]?.checksum;
    if (appliedChecksum !== hash) {
      throw new Error(`Checksum migration berubah: ${file}`);
    }
    return false;
  }

  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${env.DB_MIGRATION_TIMEOUT_MS}ms`,
    ]);
    await client.query("SELECT set_config('lock_timeout', '5s', true)");
    await client.query(body);
    await client.query(`INSERT INTO ${LEDGER_TABLE} (version, checksum) VALUES ($1, $2)`, [
      file,
      hash,
    ]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const client = createClient();
  await client.connect();
  let locked = false;
  try {
    await client.query(ADVISORY_LOCK_SQL);
    locked = true;
    await ensureLedger(client);
    const files = await listMigrations();
    if (files.length === 0) {
      console.log('Tidak ada file migration.');
      return;
    }
    for (const file of files) {
      const applied = await applyMigration(client, file);
      console.log(`${applied ? 'applied' : 'skipped'} ${file}`);
    }
  } finally {
    if (locked) {
      try {
        await client.query(ADVISORY_UNLOCK_SQL);
      } catch {
        console.error('Gagal melepas advisory lock migration.');
      }
    }
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Migration gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});