import { createHmac } from 'node:crypto';

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

export function hashEmail(normalized: string, secret: string): string {
  return createHmac('sha256', secret).update(`hadir.email.v1|${normalized}`).digest('hex');
}
