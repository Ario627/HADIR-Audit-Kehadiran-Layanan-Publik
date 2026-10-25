import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

const CSRF_VERSION = 'v1';
const CSRF_RANDOM_BYTES = 16;
const CSRF_RANDOM_LENGTH = 22;
const CSRF_SIGNATURE_LENGTH = 43;
const CSRF_MAX_TOKEN_LENGTH = 128;
const CSRF_BOOTSTRAP_METHOD = 'POST';
const CSRF_BOOTSTRAP_PATH = '/v1/devices';

export interface CsrfTokenInput {
  deviceHash: string;
  secret: string;
  now: Date;
  ttlMs: number;
}

export interface CsrfVerifyInput {
  deviceHash: string;
  secret: string;
  now: Date;
}

interface ParsedCsrfToken {
  expiresAt: number;
  payload: string;
  signature: string;
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : null;
}

function signatureFor(secret: string, deviceHash: string, payload: string): string {
  return hmac(secret, `hadir.csrf.v1|${deviceHash}|${payload}`);
}

function parseCsrfToken(token: string): ParsedCsrfToken | null {
  if (token.length === 0 || token.length > CSRF_MAX_TOKEN_LENGTH) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const [version, expiresRaw, random, signature] = parts;
  if (
    version !== CSRF_VERSION ||
    expiresRaw === undefined ||
    random === undefined ||
    signature === undefined
  ) {
    return null;
  }
  if (random.length !== CSRF_RANDOM_LENGTH || signature.length !== CSRF_SIGNATURE_LENGTH) {
    return null;
  }
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt)) {
    return null;
  }
  return {
    expiresAt,
    payload: `${version}.${expiresRaw}.${random}`,
    signature,
  };
}

export function isTrustedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined || origin.length === 0) {
    return false;
  }
  try {
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function issueCsrfToken(input: CsrfTokenInput): string {
  const expiresAt = input.now.getTime() + input.ttlMs;
  const random = randomBytes(CSRF_RANDOM_BYTES).toString('base64url');
  const payload = `${CSRF_VERSION}.${expiresAt}.${random}`;
  return `${payload}.${signatureFor(input.secret, input.deviceHash, payload)}`;
}

export function verifyCsrfToken(token: string, input: CsrfVerifyInput): boolean {
  const parsed = parseCsrfToken(token);
  if (parsed === null || parsed.expiresAt <= input.now.getTime()) {
    return false;
  }
  const expected = signatureFor(input.secret, input.deviceHash, parsed.payload);
  return safeEqual(parsed.signature, expected);
}

export function assertTrustedMutation(request: Request, allowedOrigins: readonly string[]): void {
  const origin = request.header('origin');
  if (!isTrustedOrigin(origin, allowedOrigins)) {
    throw new AppError('CSRF_INVALID', {
      detail: 'Origin permintaan tidak diizinkan.',
    });
  }
  const site = request.header('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'same-site') {
    throw new AppError('CSRF_INVALID', {
      detail: 'Permintaan lintas situs ditolak.',
    });
  }
  if (request.header('sec-fetch-mode') === 'navigate') {
    throw new AppError('CSRF_INVALID', {
      detail: 'Navigasi lintas situs tidak diizinkan untuk mutasi.',
    });
  }
}

export function readCsrfCookie(request: Request): string | null {
  return readCookie(request, env.csrfCookieName);
}

function isCsrfBootstrapRequest(request: Request): boolean {
  return request.method === CSRF_BOOTSTRAP_METHOD && request.path === CSRF_BOOTSTRAP_PATH;
}

export function csrfMiddleware(request: Request, response: Response, next: NextFunction): void {
  if (!isCsrfBootstrapRequest(request)) {
    next();
    return;
  }
  const device = request.context?.device;
  if (!device) {
    next();
    return;
  }
  const now = new Date();
  const existing = readCsrfCookie(request);
  if (
    existing !== null &&
    verifyCsrfToken(existing, {
      deviceHash: device.hash,
      secret: env.SESSION_SECRET,
      now,
    })
  ) {
    next();
    return;
  }
  const token = issueCsrfToken({
    deviceHash: device.hash,
    secret: env.SESSION_SECRET,
    now,
    ttlMs: env.CSRF_TOKEN_TTL_MS,
  });
  response.setHeader('Cache-Control', 'no-store');
  response.cookie(env.csrfCookieName, token, {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.CSRF_TOKEN_TTL_MS,
    priority: 'high',
  });
  next();
}