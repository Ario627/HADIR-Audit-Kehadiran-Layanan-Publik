import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface PutObjectInput {
  key: string;
  bytes: Buffer;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export function objectKeyFor(prefix: string, bytes: Buffer, extension: string): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `${prefix}/${digest.slice(0, 2)}/${digest}.${extension}`;
}

export function assertSafeObjectKey(key: string): void {
  if (!/^[a-z_]+(?:\/[a-z0-9]{2})?\/[a-f0-9]{64}\.[a-z]{3,4}$/.test(key)) {
    throw new Error('Object key tidak valid.');
  }
}

export function randomSuffix(): string {
  return randomBytes(8).toString('hex');
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertSafeObjectKey(key);
    return resolve(this.root, key);
  }

  async put(input: PutObjectInput): Promise<void> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes, { mode: 0o640, flag: 'wx' });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      return;
    }
  }
}
