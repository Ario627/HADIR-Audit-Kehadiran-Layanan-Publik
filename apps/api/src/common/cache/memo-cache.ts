export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MISS = Symbol('memo-cache.miss');

function isMiss(value: unknown): value is typeof MISS {
  return value === MISS;
}

export interface MemoCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export class MemoCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly now: () => number;

  constructor(private readonly options: MemoCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  private read(key: string): T | typeof MISS {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return MISS;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return MISS;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  private write(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  peek(key: string): T | null {
    const value = this.read(key);
    return isMiss(value) ? null : value;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.read(key);
    if (!isMiss(cached)) {
      return cached;
    }
    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const promise = load()
      .then((value) => {
        this.write(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
}
