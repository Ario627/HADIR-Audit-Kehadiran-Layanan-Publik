import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGetChecked, type PayloadSchema } from './api';
import { clearEtags } from './etag-cache';

const SCHEMA: PayloadSchema<{ value: number }> = {
  safeParse(value) {
    if (typeof value === 'object' && value !== null && 'value' in value) {
      const candidate = value as { value: unknown };
      if (typeof candidate.value === 'number') {
        return { success: true, data: { value: candidate.value } };
      }
    }
    return { success: false };
  },
};

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface Call {
  conditional: string | null;
}

function installFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const call = { conditional: headers.get('if-none-match') };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

beforeEach(() => {
  clearEtags();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEtags();
});

describe('kondisional GET', () => {
  it('mengirim If-None-Match setelah menerima ETag lalu memakai salinan lokal saat 304', async () => {
    const calls = installFetch((call) =>
      call.conditional === null
        ? jsonResponse({ data: { value: 7 }, meta: { requestId: 'r1', generatedAt: '2026-10-28T00:00:00.000Z' } }, { etag: '"v1"' })
        : new Response(null, { status: 304 }),
    );

    const first = await apiGetChecked('/v1/stops/x/estimate', SCHEMA);
    expect(first.data.value).toBe(7);

    const second = await apiGetChecked('/v1/stops/x/estimate', SCHEMA);
    expect(second.data.value).toBe(7);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.conditional).toBe('"v1"');
  });

  it('mengulang sekali tanpa If-None-Match bila 304 datang tanpa salinan lokal', async () => {
    const calls = installFetch((call) =>
      call.conditional === null
        ? jsonResponse({ data: { value: 3 }, meta: { requestId: 'r2', generatedAt: '2026-10-28T00:00:00.000Z' } }, { etag: '"v2"' })
        : new Response(null, { status: 304 }),
    );

    await apiGetChecked('/v1/stops/y/estimate', SCHEMA);
    clearEtags();

    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ conditional: headers.get('if-none-match') });
      if (headers.get('if-none-match') !== null) {
        return new Response(null, { status: 304 });
      }
      return jsonResponse(
        { data: { value: 9 }, meta: { requestId: 'r3', generatedAt: '2026-10-28T00:00:00.000Z' } },
        { etag: '"v3"' },
      );
    });

    const recovered = await apiGetChecked('/v1/stops/y/estimate', SCHEMA);
    expect(recovered.data.value).toBe(9);
  });

  it('tidak menyimpan ETag untuk respons no-store atau private', async () => {
    const calls = installFetch(() =>
      jsonResponse(
        { data: { value: 1 }, meta: { requestId: 'r4', generatedAt: '2026-10-28T00:00:00.000Z' } },
        { etag: '"v4"', 'cache-control': 'no-store' },
      ),
    );

    await apiGetChecked('/v1/episodes/active', SCHEMA);
    await apiGetChecked('/v1/episodes/active', SCHEMA);
    expect(calls.map((call) => call.conditional)).toEqual([null, null]);
  });

  it('tidak menyimpan ETag untuk respons privat perangkat', async () => {
    const calls = installFetch(() =>
      jsonResponse(
        { data: { value: 1 }, meta: { requestId: 'r5', generatedAt: '2026-10-28T00:00:00.000Z' } },
        { etag: '"v5"', 'cache-control': 'no-store, private, max-age=0' },
      ),
    );

    await apiGetChecked('/v1/reports/mine', SCHEMA);
    await apiGetChecked('/v1/reports/mine', SCHEMA);
    expect(calls.every((call) => call.conditional === null)).toBe(true);
  });
});
