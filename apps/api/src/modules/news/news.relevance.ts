import {
  NEWS_MAX_AGE_DAYS,
  NEWS_MAX_EXCERPT,
  NEWS_MAX_ITEMS,
  NEWS_MAX_SOURCE,
  NEWS_MAX_TITLE,
  TRANSPORT_TERMS,
  type NewsRegion,
} from './news.constants';
import { normalizeSpace, type RawFeedItem } from './news.xml';

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  source: string;
  publishedAt: string | null;
  imageUrl: string | null;
  hasVideo: boolean;
  scope: 'daerah' | 'nasional';
}

const VIDEO_HINTS: readonly string[] = ['video', 'vidio', 'youtube', 'tayangan', 'live'];

export function matchesTransport(text: string): boolean {
  const haystack = text.toLowerCase();
  return TRANSPORT_TERMS.some((term) => haystack.includes(term));
}

export function matchesRegion(text: string, region: NewsRegion): boolean {
  if (region.places.length === 0) {
    return true;
  }
  const haystack = text.toLowerCase();
  return region.places.some((place) => haystack.includes(place));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function publisherOf(url: string, fallback: string): string {
  const host = hostOf(url);
  if (host === null) {
    return fallback;
  }
  const cleaned = host.replace(/^www\./, '');
  return cleaned.slice(0, NEWS_MAX_SOURCE);
}

export function excerptOf(summary: string, title: string): string {
  const source = normalizeSpace(summary);
  const fallback = normalizeSpace(title);
  const chosen = source.length === 0 ? fallback : source;
  if (chosen.length <= NEWS_MAX_EXCERPT) {
    return chosen;
  }
  const cut = chosen.slice(0, NEWS_MAX_EXCERPT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function detectVideo(item: RawFeedItem): boolean {
  return VIDEO_HINTS.some((hint) => item.title.toLowerCase().includes(hint));
}

export function isFresh(item: RawFeedItem, now: number): boolean {
  if (item.publishedAt === null) {
    return true;
  }
  const published = Date.parse(item.publishedAt);
  if (!Number.isFinite(published)) {
    return true;
  }
  return now - published <= NEWS_MAX_AGE_DAYS * 86_400_000;
}

export function idOf(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

export function dedupe(items: readonly NewsItem[]): NewsItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const output: NewsItem[] = [];
  for (const item of items) {
    const titleKey = item.title.toLowerCase();
    if (seenUrl.has(item.url) || seenTitle.has(titleKey)) {
      continue;
    }
    seenUrl.add(item.url);
    seenTitle.add(titleKey);
    output.push(item);
  }
  return output;
}

export function toNewsItem(
  item: RawFeedItem,
  publisher: string,
  scope: 'daerah' | 'nasional',
): NewsItem {
  const source = publisherOf(item.link, publisher);
  return {
    id: idOf(item.link),
    title: item.title.slice(0, NEWS_MAX_TITLE),
    excerpt: excerptOf(item.summary, item.title),
    url: item.link,
    source,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    hasVideo: detectVideo(item),
    scope,
  };
}

export function rankNews(items: readonly NewsItem[]): NewsItem[] {
  return [...items].sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope === 'daerah' ? -1 : 1;
    }
    const leftTime = left.publishedAt === null ? 0 : Date.parse(left.publishedAt);
    const rightTime = right.publishedAt === null ? 0 : Date.parse(right.publishedAt);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title, 'id');
  });
}

export function selectNews(
  items: readonly RawFeedItem[],
  publisherByUrl: (url: string) => string,
  region: NewsRegion,
  now: number,
): NewsItem[] {
  const kept: NewsItem[] = [];
  for (const item of items) {
    if (!isFresh(item, now)) {
      continue;
    }
    const text = `${item.title} ${item.summary}`;
    if (!matchesTransport(text)) {
      continue;
    }
    const regional = matchesRegion(text, region);
    if (!regional && region.places.length === 0) {
      continue;
    }
    kept.push(toNewsItem(item, publisherByUrl(item.link), regional ? 'daerah' : 'nasional'));
    if (kept.length >= NEWS_MAX_ITEMS * 3) {
      break;
    }
  }
  return rankNews(dedupe(kept)).slice(0, NEWS_MAX_ITEMS);
}