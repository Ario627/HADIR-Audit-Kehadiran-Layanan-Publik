import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

const InvitePayload = z.object({
  sub: z.string().uuid(),
  inst: z.string().uuid(),
  role: z.enum(['viewer', 'responder', 'admin']),
  jti: z.string().min(16).max(64),
  exp: z.number().int(),
});

export type InvitePayload = z.infer<typeof InvitePayload>;

export interface DecodedInvite {
  payload: InvitePayload;
  raw: string;
}

function hmac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`hadir.invite.v1|${body}`).digest();
}

export function signInvite(payload: InvitePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(InvitePayload.parse(payload)), 'utf8').toString(
    'base64url',
  );
  return `${body}.${hmac(secret, body).toString('base64url')}`;
}

export function verifyInvite(raw: string, secret: string, now: Date): DecodedInvite | null {
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) {
    return null;
  }
  const body = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!SEGMENT_PATTERN.test(body) || !SEGMENT_PATTERN.test(signature)) {
    return null;
  }
  const expected = hmac(secret, body);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  const parsed = InvitePayload.safeParse(
    JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
  );
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.exp * 1_000 <= now.getTime()) {
    return null;
  }
  return { payload: parsed.data, raw };
}