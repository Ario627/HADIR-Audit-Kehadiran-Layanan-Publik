import { MemoCache } from './memo-cache';

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('MemoCache', () => {
  it('loads once and reuses the value inside the ttl', async () => {
    const time = clock();
    const cache = new MemoCache<number>({ ttlMs: 1_000, maxEntries: 8, now: time.now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return 42;
    };

    expect(await cache.getOrLoad('a', load)).toBe(42);
    expect(await cache.getOrLoad('a', load)).toBe(42);
    expect(loads).toBe(1);
  });

  it('reloads after the ttl elapses', async () => {
    const time = clock();
    const cache = new MemoCache<number>({ ttlMs: 1_000, maxEntries: 8, now: time.now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };

    await cache.getOrLoad('a', load);
    time.advance(1_001);
    const second = await cache.getOrLoad('a', load);

    expect(loads).toBe(2);
    expect(second).toBe(2);
  });

  it('treats an expiry exactly at now as stale', async () => {
    const time = clock();
    const cache = new MemoCache<number>({ ttlMs: 1_000, maxEntries: 8, now: time.now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };

    await cache.getOrLoad('a', load);
    time.advance(1_000);
    await cache.getOrLoad('a', load);

    expect(loads).toBe(2);
  });

  it('coalesces concurrent loads for the same key', async () => {
    const cache = new MemoCache<string>({ ttlMs: 1_000, maxEntries: 8 });
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'value';
    };

    const results = await Promise.all([
      cache.getOrLoad('a', load),
      cache.getOrLoad('a', load),
      cache.getOrLoad('a', load),
    ]);

    expect(results).toEqual(['value', 'value', 'value']);
    expect(loads).toBe(1);
  });

  it('does not coalesce different keys', async () => {
    const cache = new MemoCache<string>({ ttlMs: 1_000, maxEntries: 8 });

    const [left, right] = await Promise.all([
      cache.getOrLoad('a', async () => 'a'),
      cache.getOrLoad('b', async () => 'b'),
    ]);

    expect(left).toBe('a');
    expect(right).toBe('b');
  });

  it('evicts the oldest entry when full', async () => {
    const cache = new MemoCache<number>({ ttlMs: 60_000, maxEntries: 2 });

    await cache.getOrLoad('a', async () => 1);
    await cache.getOrLoad('b', async () => 2);
    await cache.getOrLoad('c', async () => 3);

    expect(cache.size).toBe(2);
    expect(cache.peek('a')).toBeNull();
    expect(cache.peek('b')).toBe(2);
    expect(cache.peek('c')).toBe(3);
  });

  it('refreshes recency on read so hot keys survive eviction', async () => {
    const cache = new MemoCache<number>({ ttlMs: 60_000, maxEntries: 2 });

    await cache.getOrLoad('a', async () => 1);
    await cache.getOrLoad('b', async () => 2);
    await cache.getOrLoad('a', async () => 1);
    await cache.getOrLoad('c', async () => 3);

    expect(cache.peek('a')).toBe(1);
    expect(cache.peek('b')).toBeNull();
  });

  it('never caches a rejected load', async () => {
    const cache = new MemoCache<number>({ ttlMs: 1_000, maxEntries: 8 });
    let attempts = 0;

    await expect(
      cache.getOrLoad('a', async () => {
        attempts += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const value = await cache.getOrLoad('a', async () => {
      attempts += 1;
      return 7;
    });

    expect(value).toBe(7);
    expect(attempts).toBe(2);
  });

  it('can invalidate a single key', async () => {
    const cache = new MemoCache<number>({ ttlMs: 60_000, maxEntries: 8 });
    await cache.getOrLoad('a', async () => 1);

    cache.invalidate('a');

    expect(cache.peek('a')).toBeNull();
  });

  it('can clear everything', async () => {
    const cache = new MemoCache<number>({ ttlMs: 60_000, maxEntries: 8 });
    await cache.getOrLoad('a', async () => 1);
    await cache.getOrLoad('b', async () => 2);

    cache.clear();

    expect(cache.size).toBe(0);
  });

  it('accepts a null value without treating it as a miss', async () => {
    const cache = new MemoCache<number | null>({ ttlMs: 60_000, maxEntries: 8 });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return null;
    };

    expect(await cache.getOrLoad('a', load)).toBeNull();
    expect(await cache.getOrLoad('a', load)).toBeNull();
    expect(loads).toBe(1);
  });
});
