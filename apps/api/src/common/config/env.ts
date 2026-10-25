import { z } from 'zod';

const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me-0000000000';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  DATABASE_URL: z.string().min(1).default('postgres://hadir:hadir@localhost:5432/hadir'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  QR_KEYRING_JSON: z.string().optional(),
  DEV_TOOLS: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(16).default(0),
  BODY_LIMIT: z.string().min(1).default('256kb'),
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

  if (value.NODE_ENV === 'production' && value.SESSION_SECRET === DEV_SESSION_SECRET) {
    throw new Error('SESSION_SECRET wajib diisi dengan secret nyata di production.');
  }
  if (value.NODE_ENV === 'production' && value.DEV_TOOLS === 'true') {
    throw new Error('DEV_TOOLS tidak boleh aktif di production.');
  }

  const isProduction = value.NODE_ENV === 'production';

  return Object.freeze({
    ...value,
    isProduction,
    isTest: value.NODE_ENV === 'test',
    devTools: value.DEV_TOOLS === 'true' && !isProduction,
    webOrigins: parseOrigins(value.WEB_ORIGIN),
    deviceCookieName: isProduction ? '__Host-hadir_device' : 'hadir_device',
    cookieSecure: isProduction,
    qrKeyringJson: value.QR_KEYRING_JSON?.trim() || null,
  });
}

export type Env = ReturnType<typeof loadEnv>;

export const env = loadEnv();