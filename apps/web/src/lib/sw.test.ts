import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = fileURLToPath(new URL('../../public/sw.js', import.meta.url));
const ORIGIN = 'https://hadir.id';

interface FakeResponse {
  ok: boolean;
  type: string;
  body: string;
  headers: { get(name: string): string | null };
  clone(): FakeResponse;
}

function response(cacheControl: string, body = 'net'): FakeResponse {
  const make = (): FakeResponse => ({
    ok: true,
    type: 'basic',
    body,
    headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? cacheControl : null) },
    clone: make,
  });
  return make();
}

function keyOf(key: string | { url: string }): string {
  return typeof key === 'string' ? key : key.url;
}

interface Harness {
  dispatchFetch(input: {
    url: string;
    method?: string;
    mode?: string;
  }): Promise<unknown>;
  dispatched(): readonly string[];
  store(cacheName: string): Map<string, FakeResponse>;
  cacheNames(): readonly string[];
}

function createHarness(options: {
  network?: (url: string) => FakeResponse | Error;
  seed?: Record<string, Record<string, FakeResponse>>;
}): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, FakeResponse>>();
  const fetched: string[] = [];

  for (const [name, entries] of Object.entries(options.seed ?? {})) {
    stores.set(name, new Map(Object.entries(entries)));
  }

  const storeFor = (name: string): Map<string, FakeResponse> => {
    const existing = stores.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, FakeResponse>();
    stores.set(name, created);
    return created;
  };

  const cacheApi = {
    open: async (name: string) => {
      const map = storeFor(name);
      return {
        put: async (key: string | { url: string }, res: FakeResponse) => {
          map.set(keyOf(key), res);
        },
        match: async (key: string | { url: string }) => map.get(keyOf(key)),
        keys: async () => [...map.keys()].map((url) => ({ url })),
        delete: async (key: string | { url: string }) => map.delete(keyOf(key)),
        addAll: async () => undefined,
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
  };

  const fetchImpl = async (request: { url: string }) => {
    fetched.push(request.url);
    const outcome = options.network === undefined ? response('public, max-age=60') : options.network(request.url);
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };

  vm.runInNewContext(readFileSync(SOURCE_PATH, 'utf8'), {
    self,
    caches: cacheApi,
    fetch: fetchImpl,
    URL,
    Promise,
    console,
  });

  const fetchHandler = listeners.get('fetch');
  if (fetchHandler === undefined) {
    throw new Error('service worker did not register a fetch listener');
  }

  return {
    async dispatchFetch(input) {
      let captured: unknown = null;
      let responded = false;
      const request = {
        url: input.url,
        method: input.method ?? 'GET',
        mode: input.mode ?? 'no-cors',
      };
      fetchHandler({
        request,
        respondWith: (value: unknown) => {
          responded = true;
          captured = value;
        },
      });
      if (!responded) {
        return null;
      }
      return await captured;
    },
    dispatched: () => fetched,
    store: storeFor,
    cacheNames: () => [...stores.keys()],
  };
}

describe('service worker routing', () => {
  it('ignores non-GET requests', async () => {
    const harness = createHarness({});
    expect(await harness.dispatchFetch({ url: `${ORIGIN}/v1/reports`, method: 'POST' })).toBeNull();
    expect(harness.dispatched()).toEqual([]);
  });

  it('ignores cross-origin requests', async () => {
    const harness = createHarness({});
    expect(await harness.dispatchFetch({ url: 'https://evil.example/v1/stops' })).toBeNull();
    expect(harness.dispatched()).toEqual([]);
  });

  it('ignores unlisted same-origin paths', async () => {
    const harness = createHarness({});
    expect(await harness.dispatchFetch({ url: `${ORIGIN}/robots.txt` })).toBeNull();
    expect(harness.dispatched()).toEqual([]);
  });
});

describe('service worker privacy', () => {
  const privatePaths = [
    '/v1/reports/mine',
    '/v1/reports/mine/ABC123',
    '/v1/episodes/0192f0d0',
    '/v1/devices',
    '/v1/partner/reports',
    '/v1/admin/audit',
    '/v1/internal/metrics',
    '/v1/uploads',
    '/v1/triage',
  ];

  it('never intercepts a private API path', async () => {
    const harness = createHarness({});
    for (const path of privatePaths) {
      expect(await harness.dispatchFetch({ url: `${ORIGIN}${path}` })).toBeNull();
    }
    expect(harness.dispatched()).toEqual([]);
  });

  it('still serves public API reads', async () => {
    const harness = createHarness({});
    const served = await harness.dispatchFetch({ url: `${ORIGIN}/v1/stops?limit=10` });
    expect(served).not.toBeNull();
    expect(harness.dispatched()).toHaveLength(1);
  });
});

describe('service worker caching', () => {
  it('caches a public API read that allows caching', async () => {
    const harness = createHarness({});
    await harness.dispatchFetch({ url: `${ORIGIN}/v1/stops` });
    expect(harness.store('hadir-v2-api').has(`${ORIGIN}/v1/stops`)).toBe(true);
  });

  it('refuses to cache no-store and private responses', async () => {
    for (const header of ['no-store', 'private, max-age=0', 'no-store, private, max-age=0']) {
      const harness = createHarness({ network: () => response(header) });
      await harness.dispatchFetch({ url: `${ORIGIN}/v1/estimates` });
      expect(harness.store('hadir-v2-api').has(`${ORIGIN}/v1/estimates`)).toBe(false);
    }
  });

  it('falls back to the cache when the network fails', async () => {
    const harness = createHarness({
      network: () => new Error('offline'),
      seed: {
        'hadir-v2-api': {
          [`${ORIGIN}/v1/coverage/summary`]: response('public', 'cached'),
        },
      },
    });
    const served = (await harness.dispatchFetch({
      url: `${ORIGIN}/v1/coverage/summary`,
    })) as FakeResponse;
    expect(served.body).toBe('cached');
  });

  it('rethrows when the network fails and nothing is cached', async () => {
    const harness = createHarness({ network: () => new Error('offline') });
    await expect(harness.dispatchFetch({ url: `${ORIGIN}/v1/stops` })).rejects.toThrow('offline');
  });

  it('serves the app shell for a navigation when offline', async () => {
    const harness = createHarness({
      network: () => new Error('offline'),
      seed: { 'hadir-v2-shell': { '/': response('public', 'shell') } },
    });
    const served = (await harness.dispatchFetch({
      url: `${ORIGIN}/wait/abc`,
      mode: 'navigate',
    })) as FakeResponse;
    expect(served.body).toBe('shell');
  });

  it('prefers an exact cached page for a navigation when offline', async () => {
    const harness = createHarness({
      network: () => new Error('offline'),
      seed: {
        'hadir-v2-shell': {
          [`${ORIGIN}/metodologi`]: response('public', 'exact'),
          '/': response('public', 'shell'),
        },
      },
    });
    const served = (await harness.dispatchFetch({
      url: `${ORIGIN}/metodologi`,
      mode: 'navigate',
    })) as FakeResponse;
    expect(served.body).toBe('exact');
  });

  it('caches assets first without touching the network twice', async () => {
    const harness = createHarness({
      seed: { 'hadir-v2-assets': { [`${ORIGIN}/assets/app.js`]: response('public', 'asset') } },
    });
    const served = (await harness.dispatchFetch({
      url: `${ORIGIN}/assets/app.js`,
    })) as FakeResponse;
    expect(served.body).toBe('asset');
    expect(harness.dispatched()).toEqual([]);
  });
});
