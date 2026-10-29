import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';

const INTERNAL_AUDIENCE = 'estimator';
const MAX_SKEW_SECONDS = 30;

export interface InternalClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
}

function base64urlDecode(raw: string): Buffer {
  return Buffer.from(raw, 'base64url');
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyInternalJwt(
  token: string,
  secret: Buffer,
  nowSeconds: number,
): InternalClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }
  if (
    header === null ||
    typeof header !== 'object' ||
    (header as Record<string, unknown>).alg !== 'HS256'
  ) {
    return null;
  }
  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  if (!safeEqual(expected, base64urlDecode(encodedSignature))) {
    return null;
  }
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const claims = payload as Record<string, unknown>;
  if (claims.aud !== INTERNAL_AUDIENCE) {
    return null;
  }
  const exp = typeof claims.exp === 'number' ? claims.exp : null;
  const iat = typeof claims.iat === 'number' ? claims.iat : null;
  if (exp === null || iat === null) {
    return null;
  }
  if (exp + MAX_SKEW_SECONDS < nowSeconds) {
    return null;
  }
  if (iat - MAX_SKEW_SECONDS > nowSeconds) {
    return null;
  }
  return {
    iss: typeof claims.iss === 'string' ? claims.iss : '',
    aud: INTERNAL_AUDIENCE,
    exp,
    iat,
    sub: typeof claims.sub === 'string' ? claims.sub : '',
  };
}

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = env.internalSharedSecret;
    const request = context.switchToHttp().getRequest<Request>();
    if (configured === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Endpoint internal tidak aktif.',
      });
    }
    const provided = request.header('x-internal-secret');
    if (provided === undefined) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Header x-internal-secret wajib ada.',
      });
    }
    const secret = Buffer.from(configured, 'utf8');
    if (!safeEqual(Buffer.from(provided, 'utf8'), secret)) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Secret internal tidak valid.' });
    }
    const authorization = request.header('authorization');
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Bearer JWT wajib menyertai permintaan internal.',
      });
    }
    const claims = verifyInternalJwt(
      authorization.slice('Bearer '.length).trim(),
      secret,
      Math.floor(Date.now() / 1000),
    );
    if (claims === null) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'JWT internal tidak valid atau sudah kedaluwarsa.',
      });
    }
    return true;
  }
}
