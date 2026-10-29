import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../common/config/env';
import { NewsCache } from './news.cache';
import {
  NEWS_CACHE_TTL_S,
  NEWS_FEEDS,
  NEWS_FEED_TIMEOUT_MS,
  NEWS_MAX_FEED_BYTES,
  NEWS_MAX_ITEMS,
  NEWS_MEDIA_ALLOWED_HOSTS,
  NEWS_MEDIA_MAX_BYTES,
  NEWS_MEDIA_MIME,
  NEWS_MEDIA_TIMEOUT_MS,
  NEWS_REGIONS,
  type NewsRegion,
} from './news.constants';
import { selectNews, type NewsItem } from './news.relevance';
import { signMediaUrl, verifyMediaToken } from './news.token';
import { parseFeed, type RawFeedItem } from './news.xml';

export interface NewsPayloadItem extends NewsItem {
  imagePath: string | null;
}

export interface NewsPayload {
  region: { code: string; label: string };
  items: NewsPayloadItem[];
  fetchedAt: string;
}

export interface MediaResult {
  bytes: Buffer;
  mime: string;
}

const CACHE_PREFIX = 'hadir:news:v1';

function cacheKey(region: string): string {
  return `${CACHE_PREFIX}:${region}`;
}

function mediaSecret(): string {
  return env.SESSION_SECRET;
}

function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return NEWS_MEDIA_ALLOWED_HOSTS.includes(parsed.host);
  } catch {
    return false;
  }
}

async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  if (response.body === null) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchFeed(url: string): Promise<RawFeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, NEWS_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        'User-Agent': 'HADIR/1.0 (+news reader; contact via site)',
      },
    });
    if (!response.ok) {
      return [];
    }
    const buffer = await readCapped(response, NEWS_MAX_FEED_BYTES);
    if (buffer === null) {
      return [];
    }
    return parseFeed(buffer.toString('utf8'));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function publisherLookup(): (url: string) => string {
  return (url: string): string => {
    for (const feed of NEWS_FEEDS) {
      try {
        if (new URL(feed.url).host === new URL(url).host) {
          return feed.publisher;
        }
      } catch {
        continue;
      }
    }
    return 'Pemberitaan';
  };
}

function decorate(items: readonly NewsItem[], now: number): NewsPayloadItem[] {
  const secret = mediaSecret();
  return items.map((item) => ({
    ...item,
    imagePath:
      item.imageUrl !== null && isAllowedHost(item.imageUrl)
        ? `/v1/news/media/${signMediaUrl(secret, item.imageUrl, now)}`
        : null,
  }));
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private inflight: Map<string, Promise<NewsPayload>> | null = null;

  constructor(private readonly cache: NewsCache) {}

  private inFlight(): Map<string, Promise<NewsPayload>> {
    this.inflight ??= new Map<string, Promise<NewsPayload>>();
    return this.inflight;
  }

  regionOf(code: string | undefined): NewsRegion {
    const key = code ?? '';
    return NEWS_REGIONS[key] ?? NEWS_REGIONS['banyumas'] ?? Object.values(NEWS_REGIONS)[0]!;
  }

  private async build(region: NewsRegion, now: number): Promise<NewsPayload> {
    const results = await Promise.all(NEWS_FEEDS.map((feed) => fetchFeed(feed.url)));
    const raw = results.flat();
    const lookup = publisherLookup();
    const items = selectNews(raw, lookup, region, now).slice(0, NEWS_MAX_ITEMS);
    const payload: NewsPayload = {
      region: { code: region.code, label: region.label },
      items: decorate(items, now),
      fetchedAt: new Date(now).toISOString(),
    };
    await this.cache.set(cacheKey(region.code), JSON.stringify(payload), now, NEWS_CACHE_TTL_S);
    return payload;
  }

  async list(regionCode: string | undefined): Promise<NewsPayload> {
    const region = this.regionOf(regionCode);
    const now = Date.now();
    const cached = await this.cache.get(cacheKey(region.code), now);
    if (cached !== null) {
      try {
        const parsed = JSON.parse(cached) as NewsPayload;
        if (Array.isArray(parsed.items)) {
          return parsed;
        }
      } catch {
        this.logger.warn('Cache berita rusak, membangun ulang.');
      }
    }
    const existing = this.inFlight().get(region.code);
    if (existing !== undefined) {
      return existing;
    }
    const pending = this.build(region, now).finally(() => {
      this.inFlight().delete(region.code);
    });
    this.inFlight().set(region.code, pending);
    return pending;
  }

  async media(token: string): Promise<MediaResult | null> {
    const claims = verifyMediaToken(mediaSecret(), token, Date.now());
    if (claims === null || !isAllowedHost(claims.url)) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, NEWS_MEDIA_TIMEOUT_MS);
    try {
      const response = await fetch(claims.url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png;q=0.9' },
      });
      if (!response.ok) {
        return null;
      }
      const mime =
        (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!NEWS_MEDIA_MIME.includes(mime)) {
        return null;
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > NEWS_MEDIA_MAX_BYTES) {
        return null;
      }
      const bytes = await readCapped(response, NEWS_MEDIA_MAX_BYTES);
      return bytes === null ? null : { bytes, mime };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}