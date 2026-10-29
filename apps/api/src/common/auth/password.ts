import { hash, verify } from '@node-rs/argon2';

export interface PasswordParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const PASSWORD_PARAMS: PasswordParams = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

const MAX_PASSWORD_LENGTH = 256;

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$YXNkZmFzZGZhc2RmYXNkZmFzZGZhc2RmYXNkZmFzZGY';

export function passwordWithinLimits(raw: string): boolean {
  const bytes = Buffer.byteLength(raw, 'utf8');
  return bytes >= 12 && bytes <= MAX_PASSWORD_LENGTH * 4;
}

function options(params: PasswordParams) {
  return {
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  };
}

export async function hashPassword(
  raw: string,
  params: PasswordParams = PASSWORD_PARAMS,
): Promise<string> {
  return hash(raw, options(params));
}

export async function verifyPassword(
  storedHash: string,
  raw: string,
  params: PasswordParams = PASSWORD_PARAMS,
): Promise<boolean> {
  try {
    return await verify(storedHash, raw, options(params));
  } catch {
    return false;
  }
}

export async function burnPasswordTime(
  raw: string,
  params: PasswordParams = PASSWORD_PARAMS,
): Promise<void> {
  await verifyPassword(DUMMY_HASH, raw, params);
}

export function needsRehash(storedHash: string, params: PasswordParams = PASSWORD_PARAMS): boolean {
  return (
    !storedHash.includes(`m=${params.memoryCost},`) ||
    !storedHash.includes(`t=${params.timeCost},`) ||
    !storedHash.includes(`p=${params.parallelism}`) ||
    !storedHash.startsWith('$argon2id$')
  );
}