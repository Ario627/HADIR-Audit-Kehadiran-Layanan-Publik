import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { contextOf } from './request-context';

const COOKIE_VERSION = 'v1';
const DEVICE_ID_BYTES = 32;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const DEVICE_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function signDeviceId(deviceId: string, secret: string = env.SESSION_SECRET): string {
  return `${deviceId}.${hmac(secret, `hadir.device.cookie.${COOKIE_VERSION}|${deviceId}`)}`;
}

export function verifyDeviceCookie(value: string, secret: string = env.SESSION_SECRET): string | null {
  const separator = value.lastIndexOf('.');
  if (separator <= 0) {
    return null;
  }
  const deviceId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!DEVICE_ID_PATTERN.test(deviceId) || !SIGNATURE_PATTERN.test(signature)) {
    return null;
  }
  const expected = hmac(secret, `hadir.device.cookie.${COOKIE_VERSION}|${deviceId}`);
  return safeEqual(signature, expected) ? deviceId : null;
}

export function deriveDeviceIdentity(
  raw: string,
  now: Date,
  secret: string = env.SESSION_SECRET,
): { hash: string; dayHash: string } {
  const day = now.toISOString().slice(0, 10);
  return {
    hash: createHmac('sha256', secret).update(`hadir.device.id.v1|${raw}`).digest('hex'),
    dayHash: createHmac('sha256', secret).update(`hadir.device.day.v1|${day}|${raw}`).digest('hex'),
  };
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : null;
}

export function deviceMiddleware(request: Request, response: Response, next: NextFunction): void {
  const context = contextOf(request);
  const existing = readCookie(request, env.deviceCookieName);
  const verified = existing === null ? null : verifyDeviceCookie(existing);
  const raw = verified ?? randomBytes(DEVICE_ID_BYTES).toString('base64url');

  if (verified === null) {
    const options: CookieOptions = {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    };
    response.cookie(env.deviceCookieName, signDeviceId(raw), options);
  }

  const identity = deriveDeviceIdentity(raw, new Date());
  context.device = { ...identity, isNew: verified === null };
  context.actor = { kind: 'citizen', deviceHash: identity.hash };
  next();
}
