export const NEWS_REGIONS = ['banyumas', 'semarang', 'jateng', 'nasional'] as const;

export type NewsRegionCode = (typeof NEWS_REGIONS)[number];

export const NEWS_REGION_LABELS: Record<NewsRegionCode, string> = {
  banyumas: 'Banyumas',
  semarang: 'Semarang',
  jateng: 'Jawa Tengah',
  nasional: 'Nasional',
};

export const DEFAULT_NEWS_REGION: NewsRegionCode = 'banyumas';

export const NEWS_LIMIT = 12;
export const NEWS_MAX_TITLE = 160;
export const NEWS_MAX_EXCERPT = 200;
export const NEWS_MAX_SOURCE = 60;
export const NEWS_MAX_ID = 24;

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  source: string;
  publishedAt: string | null;
  imagePath: string | null;
  hasVideo: boolean;
  scope: 'daerah' | 'nasional';
}

export interface NewsFeed {
  region: { code: NewsRegionCode; label: string };
  items: readonly NewsItem[];
  fetchedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNewsRegion(value: unknown): value is NewsRegionCode {
  return typeof value === 'string' && (NEWS_REGIONS as readonly string[]).includes(value);
}

export function readNewsRegion(value: unknown): NewsRegionCode {
  return isNewsRegion(value) ? value : DEFAULT_NEWS_REGION;
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

function readClamped(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function readIso(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 600) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeImagePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1400) {
    return null;
  }
  if (!value.startsWith('/v1/news/media/')) {
    return null;
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x5c || char === ' ') {
      return null;
    }
  }
  return value;
}

export function toNewsItem(value: unknown): NewsItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, NEWS_MAX_ID);
  const title = readText(value.title, NEWS_MAX_TITLE);
  const excerpt = readClamped(value.excerpt, NEWS_MAX_EXCERPT);
  const url = safeHttpUrl(value.url);
  const source = readText(value.source, NEWS_MAX_SOURCE);
  const publishedAt = readIso(value.publishedAt);
  const scope = value.scope === 'daerah' || value.scope === 'nasional' ? value.scope : null;
  if (id === null || title === null || url === null || source === null) {
    return null;
  }
  if (publishedAt === undefined || scope === null) {
    return null;
  }
  return {
    id,
    title,
    excerpt,
    url,
    source,
    publishedAt,
    imagePath: safeImagePath(value.imagePath),
    hasVideo: value.hasVideo === true,
    scope,
  };
}

export function toNewsFeed(value: unknown): NewsFeed | null {
  if (!isRecord(value)) {
    return null;
  }
  const region = value.region;
  if (!isRecord(region) || !isNewsRegion(region.code)) {
    return null;
  }
  const fetchedAt = readIso(value.fetchedAt);
  const items = value.items;
  if (fetchedAt === undefined || fetchedAt === null || !Array.isArray(items)) {
    return null;
  }
  const parsed: NewsItem[] = [];
  for (const raw of items) {
    const item = toNewsItem(raw);
    if (item !== null) {
      parsed.push(item);
    }
    if (parsed.length >= NEWS_LIMIT) {
      break;
    }
  }
  return {
    region: { code: region.code, label: readText(region.label, 40) ?? NEWS_REGION_LABELS[region.code] },
    items: parsed,
    fetchedAt,
  };
}

export function ageLabel(publishedAt: string | null, now: number): string {
  if (publishedAt === null) {
    return 'waktu tidak tercatat';
  }
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) {
    return 'waktu tidak tercatat';
  }
  const diff = now - published;
  if (diff < 0) {
    return 'baru saja';
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${String(Math.max(1, minutes))} menit lalu`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} jam lalu`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'kemarin' : `${String(days)} hari lalu`;
}

export function leadItem(items: readonly NewsItem[]): NewsItem | null {
  return items.find((item) => item.imagePath !== null) ?? items[0] ?? null;
}

export function restItems(items: readonly NewsItem[], lead: NewsItem | null): NewsItem[] {
  if (lead === null) {
    return [];
  }
  return items.filter((item) => item.id !== lead.id);
}

export function scopeLabel(scope: NewsItem['scope'], regionLabel: string): string {
  return scope === 'daerah' ? regionLabel : 'Nasional';
}
