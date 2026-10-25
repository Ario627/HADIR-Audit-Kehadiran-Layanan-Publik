import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from './request-context';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeBase32(value: bigint, length: number): string {
  let remaining = value;
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(remaining & 31n)] + output;
    remaining >>= 5n;
  }
  return output;
}

export function ulid(now: number = Date.now()): string {
  const timestamp = BigInt(Math.trunc(now));
  if (timestamp < 0n || timestamp > 0xffffffffffffn) {
    throw new RangeError('Timestamp ULID di luar rentang 48 bit.');
  }
  const entropy = BigInt(`0x${randomBytes(10).toString('hex')}`);
  return encodeBase32(timestamp, 10) + encodeBase32(entropy, 16);
}

export function isValidRequestId(value: string): boolean {
  return value.length <= 64 && (ULID_PATTERN.test(value) || UUID_PATTERN.test(value));
}

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  const requestId = incoming !== undefined && isValidRequestId(incoming) ? incoming : ulid();
  const context: RequestContext = {
    requestId,
    device: null,
    actor: null,
  };
  request.context = context;
  response.locals.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}
