import type { Envelope, Meta } from '@hadir/contracts';

type MetaExtra = Partial<Omit<Meta, 'requestId' | 'generatedAt'>>;

export function metaFor(requestId: string, extra: MetaExtra = {}): Meta {
  return {
    requestId,
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

export function ok<T>(data: T, requestId: string, extra: MetaExtra = {}): Envelope<T> {
  return { data, meta: metaFor(requestId, extra) };
}