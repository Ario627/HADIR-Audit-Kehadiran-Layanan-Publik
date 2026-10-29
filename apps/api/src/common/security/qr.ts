import { createHmac, timingSafeEqual } from 'node:crypto';
import type { QrProof } from '@hadir/contracts';
import { z } from 'zod';
import { AppError } from '../errors/app-error';

const Epoch = z.string().regex(/^(20\d{4}|r\d{1,3})$/);
const Secret = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, 'base64').length >= 32;
    } catch {
      return false;
    }
  },
  { message: 'Secret QR minimal 32 byte base64.' },
);
const Key = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,16}$/),
    secret: Secret,
  })
  .strict();
const Keyring = z.record(Epoch, Key);

export interface QrKey {
  id: string;
  secret: Buffer;
}

export type QrKeyring = ReadonlyMap<string, QrKey>;

export function parseQrKeyring(raw: string | null): QrKeyring {
  if (raw === null || raw.trim().length === 0) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('QR_KEYRING_JSON bukan JSON yang valid.');
  }
  const result = Keyring.safeParse(parsed);
  if (!result.success) {
    throw new Error('QR_KEYRING_JSON tidak sesuai format keyring.');
  }
  const keyring = new Map<string, QrKey>();
  for (const [epoch, key] of Object.entries(result.data)) {
    keyring.set(epoch, {
      id: key.id,
      secret: Buffer.from(key.secret, 'base64'),
    });
  }
  return keyring;
}

export function verifyQrProof(keyring: QrKeyring, stopCode: string, proof: QrProof): void {
  if (keyring.size === 0) {
    throw new AppError('SERVICE_UNAVAILABLE', {
      detail: 'Verifikasi QR belum dikonfigurasi.',
    });
  }
  const key = keyring.get(proof.epoch);
  if (key === undefined) {
    throw new AppError('QR_EXPIRED', {
      detail: 'Kunci QR untuk epoch ini tidak aktif.',
    });
  }
  if (key.id !== proof.keyId) {
    throw new AppError('QR_INVALID', {
      detail: 'Kunci QR tidak cocok dengan epoch.',
    });
  }
  const expected = createHmac('sha256', key.secret)
    .update(`v1|${stopCode}|${proof.epoch}`)
    .digest()
    .subarray(0, 16);
  const actual = Buffer.from(proof.signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError('QR_INVALID', {
      detail: 'Tanda tangan QR tidak valid.',
    });
  }
}