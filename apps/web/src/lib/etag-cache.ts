interface Entry {
  etag: string;
  envelope: unknown;
}

const MAX_ENTRIES = 64;

const store = new Map<string, Entry>();

export function readEtag(path: string): string | null {
  return store.get(path)?.etag ?? null;
}

export function readCachedEnvelope<T>(path: string): T | null {
  const entry = store.get(path);
  return entry === undefined ? null : (entry.envelope as T);
}

export function rememberEtag(path: string, etag: string, envelope: unknown): void {
  store.delete(path);
  store.set(path, { etag, envelope });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done === true) {
      break;
    }
    store.delete(oldest.value);
  }
}

export function forgetEtag(path: string): void {
  store.delete(path);
}

export function clearEtags(): void {
  store.clear();
}
