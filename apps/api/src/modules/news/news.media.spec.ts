import { env } from '../../common/config/env';
import { classifyContentType, classifyUpstreamStatus, NewsService } from './news.service';
import { signMediaUrl } from './news.token';

const SECRET = env.SESSION_SECRET;
const IMAGE_URL = 'https://img.antaranews.com/cache/800x533/2026/11/10/contoh.jpg';
const LIMIT = 2 * 1024 * 1024;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response,
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function imageResponse(
  bytes: Buffer,
  contentType = 'image/jpeg',
  declared?: number,
): Response {
  const headers = new Headers({ 'content-type': contentType });
  if (declared !== undefined) {
    headers.set('content-length', String(declared));
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function buildService(): NewsService {
  return new NewsService({} as never);
}

describe('classifyUpstreamStatus', () => {
  it('accepts every 2xx', () => {
    for (const status of [200, 201, 204, 206]) {
      expect(classifyUpstreamStatus(status).ok).toBe(true);
    }
  });

  it('treats 5xx as retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyUpstreamStatus(status)).toEqual({ ok: false, retryable: true });
    }
  });

  it('treats throttling and timeouts as retryable', () => {
    for (const status of [408, 425, 429]) {
      expect(classifyUpstreamStatus(status).retryable).toBe(true);
    }
  });

  it('treats 4xx as permanent', () => {
    for (const status of [400, 403, 404, 410]) {
      expect(classifyUpstreamStatus(status)).toEqual({ ok: false, retryable: false });
    }
  });

  it('never treats a redirect as success', () => {
    for (const status of [301, 302, 307, 308]) {
      expect(classifyUpstreamStatus(status).ok).toBe(false);
    }
  });
});

describe('classifyContentType', () => {
  it('accepts the three allowed image types', () => {
    expect(classifyContentType('image/jpeg', null, LIMIT)).toBe('accept');
    expect(classifyContentType('image/png', null, LIMIT)).toBe('accept');
    expect(classifyContentType('image/webp', null, LIMIT)).toBe('accept');
  });

  it('strips parameters and ignores case', () => {
    expect(classifyContentType('IMAGE/JPEG; charset=binary', null, LIMIT)).toBe('accept');
  });

  it('rejects svg and html', () => {
    expect(classifyContentType('image/svg+xml', null, LIMIT)).toBe('reject_mime');
    expect(classifyContentType('text/html', null, LIMIT)).toBe('reject_mime');
  });

  it('rejects a missing content type', () => {
    expect(classifyContentType(null, null, LIMIT)).toBe('reject_mime');
  });

  it('rejects a declared size above the cap', () => {
    expect(classifyContentType('image/jpeg', LIMIT + 1, LIMIT)).toBe('reject_size');
  });

  it('accepts a declared size exactly at the cap', () => {
    expect(classifyContentType('image/jpeg', LIMIT, LIMIT)).toBe('accept');
  });

  it('ignores a non numeric declared size', () => {
    expect(classifyContentType('image/jpeg', Number.NaN, LIMIT)).toBe('accept');
  });
});

describe('NewsService.media', () => {
  let service: NewsService;

  beforeEach(() => {
    service = buildService();
  });

  const tokenFor = (url = IMAGE_URL): string =>
    signMediaUrl(SECRET, url, Date.now());

  it('returns ok with bytes and mime for a normal image', async () => {
    const bytes = Buffer.alloc(1024, 7);
    const stub = stubFetch(() => imageResponse(bytes));
    try {
      const result = await service.media(tokenFor());
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.mime).toBe('image/jpeg');
        expect(result.bytes.byteLength).toBe(1024);
      }
      expect(stub.calls[0]?.url).toBe(IMAGE_URL);
    } finally {
      stub.restore();
    }
  });

  it('never follows redirects', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      await service.media(tokenFor());
      expect(stub.calls[0]?.init?.redirect).toBe('error');
    } finally {
      stub.restore();
    }
  });

  it('sends an image accept header', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      await service.media(tokenFor());
      const accept = new Headers(stub.calls[0]?.init?.headers).get('accept') ?? '';
      expect(accept).toContain('image/jpeg');
    } finally {
      stub.restore();
    }
  });

  it('reports invalid_token without calling upstream', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      const result = await service.media('not-a-real-token');
      expect(result).toEqual({ kind: 'failed', reason: 'invalid_token' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('reports host_not_allowed for a signed url outside the allowlist', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      const result = await service.media(tokenFor('https://evil.example.com/a.jpg'));
      expect(result).toEqual({ kind: 'failed', reason: 'host_not_allowed' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('reports upstream_gone for a 404 without pretending it is transient', async () => {
    const stub = stubFetch(() => new Response('hilang', { status: 404 }));
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'upstream_gone' });
    } finally {
      stub.restore();
    }
  });

  it('reports upstream_unavailable for a 503 so the client may retry', async () => {
    const stub = stubFetch(() => new Response('sibuk', { status: 503 }));
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'upstream_unavailable' });
    } finally {
      stub.restore();
    }
  });

  it('reports upstream_unavailable for a 429', async () => {
    const stub = stubFetch(() => new Response('lambat', { status: 429 }));
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'upstream_unavailable' });
    } finally {
      stub.restore();
    }
  });

  it('reports upstream_unavailable when the network throws', async () => {
    const stub = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'upstream_unavailable' });
    } finally {
      stub.restore();
    }
  });

  it('reports content_rejected for a non image content type', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1), 'text/html'));
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'content_rejected' });
    } finally {
      stub.restore();
    }
  });

  it('reports content_rejected when the declared size exceeds the cap', async () => {
    const stub = stubFetch(() =>
      imageResponse(Buffer.alloc(8, 1), 'image/jpeg', LIMIT + 1),
    );
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'content_rejected' });
    } finally {
      stub.restore();
    }
  });

  it('reports content_rejected for an empty body', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(0)));
    try {
      const result = await service.media(tokenFor());
      expect(result).toEqual({ kind: 'failed', reason: 'content_rejected' });
    } finally {
      stub.restore();
    }
  });

  it('rejects an expired token', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      const expired = signMediaUrl(SECRET, IMAGE_URL, Date.now() - 8 * 86_400_000);
      const result = await service.media(expired);
      expect(result).toEqual({ kind: 'failed', reason: 'invalid_token' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const stub = stubFetch(() => imageResponse(Buffer.alloc(8, 1)));
    try {
      const forged = signMediaUrl(
        `${SECRET}-different`,
        IMAGE_URL,
        Date.now(),
      );
      const result = await service.media(forged);
      expect(result).toEqual({ kind: 'failed', reason: 'invalid_token' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });
});
