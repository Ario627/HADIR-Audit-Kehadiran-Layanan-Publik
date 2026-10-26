import { z } from 'zod';

const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me-0000000000';
const DEV_REDIS_URL = 'redis://localhost:6379';

const DatabaseUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
      } catch {
        return false;
      }
    },
    { message: 'DATABASE_URL harus URL postgres:// atau postgresql://.' },
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  DATABASE_URL: DatabaseUrl.default('postgres://hadir:hadir@localhost:5432/hadir'),
  REDIS_URL: z.string().min(1).default(DEV_REDIS_URL),
  QR_KEYRING_JSON: z.string().optional(),
  DEV_TOOLS: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(16).default(0),
  BODY_LIMIT: z.string().min(1).default('256kb'),
  CSRF_TOKEN_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(28_800_000),
  EPISODE_TAU_MINUTES: z.coerce.number().int().min(5).max(180).default(45),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  MAX_HEADERS_COUNT: z.coerce.number().int().min(10).max(2_000).default(100),
  MAX_REQUESTS_PER_SOCKET: z.coerce.number().int().min(1).max(10_000).default(100),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  DB_MIGRATION_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
  DB_APPLICATION_NAME: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).default('hadir-api'),
  DB_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DB_SSL_CA: z.string().optional(),
  MIGRATION_DATABASE_URL: DatabaseUrl.optional(),
})
  .refine((value) => value.HEADERS_TIMEOUT_MS > value.KEEP_ALIVE_TIMEOUT_MS, {
    message: 'HEADERS_TIMEOUT_MS harus lebih besar dari KEEP_ALIVE_TIMEOUT_MS.',
    path: ['HEADERS_TIMEOUT_MS'],
  })
  .refine((value) => value.REQUEST_TIMEOUT_MS >= value.HEADERS_TIMEOUT_MS, {
    message: 'REQUEST_TIMEOUT_MS tidak boleh lebih kecil dari HEADERS_TIMEOUT_MS.',
    path: ['REQUEST_TIMEOUT_MS'],
  });

function parseOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`WEB_ORIGIN bukan URL yang valid: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`WEB_ORIGIN harus memakai http atau https: ${raw}`);
  }
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`WEB_ORIGIN hanya boleh berisi origin tanpa path: ${raw}`);
  }
  return url.origin;
}

function parseOrigins(raw: string): readonly string[] {
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(parseOrigin);
  if (origins.length === 0) {
    throw new Error('WEB_ORIGIN minimal berisi satu origin.');
  }
  return Object.freeze([...new Set(origins)]);
}

function isLocalHost(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function formatEnvIssues(issues: readonly z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('; ');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Konfigurasi environment tidak valid: ${formatEnvIssues(parsed.error.issues)}`);
  }

  const value = parsed.data;
  const webOrigins = parseOrigins(value.WEB_ORIGIN);

  if (value.NODE_ENV === 'production' && value.SESSION_SECRET === DEV_SESSION_SECRET) {
    throw new Error('SESSION_SECRET wajib diisi dengan secret nyata di production.');
  }
  if (value.NODE_ENV === 'production' && value.DEV_TOOLS === 'true') {
    throw new Error('DEV_TOOLS tidak boleh aktif di production.');
  }
  if (value.NODE_ENV === 'production' && value.REDIS_URL === DEV_REDIS_URL) {
    throw new Error('REDIS_URL wajib diisi dengan instance nyata di production.');
  }
  if (value.NODE_ENV === 'production' && !value.QR_KEYRING_JSON?.trim()) {
    throw new Error('QR_KEYRING_JSON wajib diisi di production.');
  }
  if (
    value.NODE_ENV === 'production' &&
    webOrigins.some((origin) => origin.startsWith('http://'))
  ) {
    throw new Error('WEB_ORIGIN wajib memakai https di production.');
  }
  if (value.NODE_ENV === 'production' && isLocalHost(value.DATABASE_URL)) {
    throw new Error('DATABASE_URL wajib menunjuk database non-local di production.');
  }
  if (value.NODE_ENV === 'production' && value.DB_SSL_MODE !== 'verify-full') {
    throw new Error('DB_SSL_MODE wajib verify-full di production.');
  }

  const isProduction = value.NODE_ENV === 'production';

  return Object.freeze({
    ...value,
    isProduction,
    isTest: value.NODE_ENV === 'test',
    devTools: value.DEV_TOOLS === 'true' && !isProduction,
    webOrigins,
    deviceCookieName: isProduction ? '__Host-hadir_device' : 'hadir_device',
    csrfCookieName: isProduction ? '__Host-hadir_csrf' : 'hadir_csrf',
    cookieSecure: isProduction,
    episodeTauMinutes: value.EPISODE_TAU_MINUTES,
    qrKeyringJson: value.QR_KEYRING_JSON?.trim() || null,
    dbSslCa: value.DB_SSL_CA?.trim() || null,
    migrationDatabaseUrl: value.MIGRATION_DATABASE_URL?.trim() || null,
  });
}

export type Env = ReturnType<typeof loadEnv>;

export const env = loadEnv();
