import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_PLAINTEXT_BYTES = 1_024;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export function parseSecretKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError('Kunci enkripsi harus 32 byte base64.');
  }
  return key;
}

export function generateSecretKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

function frame(iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function seal(plaintext: string, key: Buffer): Buffer {
  const bytes = Buffer.from(plaintext, 'utf8');
  if (bytes.length === 0 || bytes.length > MAX_PLAINTEXT_BYTES) {
    throw new SecretBoxError('Panjang plaintext di luar batas.');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return frame(iv, cipher.getAuthTag(), ciphertext);
}

export function open(sealed: Buffer, key: Buffer): string {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new SecretBoxError('Ciphertext terlalu pendek.');
  }
  if (sealed[0] !== VERSION) {
    throw new SecretBoxError('Versi ciphertext tidak dikenal.');
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('Ciphertext gagal diautentikasi.');
  }
}

export function sealedByteLength(plaintextLength: number): number {
  if (plaintextLength < 0 || plaintextLength > MAX_PLAINTEXT_BYTES) {
    throw new SecretBoxError('Panjang plaintext di luar batas.');
  }
  return 1 + IV_BYTES + TAG_BYTES + plaintextLength;
}
