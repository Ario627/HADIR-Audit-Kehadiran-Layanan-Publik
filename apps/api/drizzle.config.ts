import { defineConfig } from 'drizzle-kit';
import { env } from './src/common/config/env';

const url = env.migrationDatabaseUrl ?? env.DATABASE_URL;
const ssl = env.DB_SSL_MODE === 'disable' ? false : env.DB_SSL_MODE;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: { url, ssl },
});