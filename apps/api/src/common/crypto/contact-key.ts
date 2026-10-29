import { createHmac } from 'node:crypto';
import { env } from '../config/env';
import { parseSecretKey } from './secret-box';

export interface ContactCipher {
  key: Buffer;
  pepper: string;
}

export function contactCipherFromEnv(): ContactCipher {
  return { key: parseSecretKey(env.contactEncryptionKey), pepper: env.SESSION_SECRET };
}

export function contactEmailHash(normalized: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(`hadir.contact.v1|${normalized}`).digest();
}
