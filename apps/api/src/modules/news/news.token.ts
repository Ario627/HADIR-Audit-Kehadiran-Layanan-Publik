import { createHmac, timingSafeEqual } from 'node:crypto';
import { NEWS_MEDIA_TOKEN_TTL_MS } from './news.constants';

export interface MediaClaims {
  url: string;
  expiresAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function payloadOf(claims: MediaClaims): string {
  return base64url(JSON.stringify({ u: claims.url, e: claims.expiresAt }));
}

function signatureOf(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signMediaUrl(secret: string, url: string, now: number): string {
  const payload = payloadOf({ url, expiresAt: now + NEWS_MEDIA_TOKEN_TTL_MS });
  return `${payload}.${signatureOf(secret, payload)}`;
}

export function verifyMediaToken(secret: string, token: string, now: number): MediaClaims | null {
  if (token.length === 0 || token.length > 900) {
    return null;
  }
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return null;
  }
  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signatureOf(secret, payload));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const url = record['u'];
  const expiresAt = record['e'];
  if (typeof url !== 'string' || typeof expiresAt !== 'number') {
    return null;
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }
  return { url, expiresAt };
}