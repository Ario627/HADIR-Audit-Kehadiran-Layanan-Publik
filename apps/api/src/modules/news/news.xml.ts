import { NEWS_MAX_FEED_BYTES, NEWS_MAX_ITEMS, NEWS_MAX_ITEMS_PER_FEED } from './news.constants';

export interface RawFeedItem {
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string;
  imageUrl: string | null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function plainText(raw: string): string {
  return normalizeSpace(decodeEntities(stripTags(stripCdata(raw))));
}

export function isSafeFeedDocument(xml: string): boolean {
  if (xml.length === 0 || xml.length > NEWS_MAX_FEED_BYTES) {
    return false;
  }
  const head = xml.slice(0, 4096).toLowerCase();
  if (head.includes('<!doctype') || head.includes('<!entity')) {
    return false;
  }
  return xml.includes('<rss') || xml.includes('<feed');
}

function extractBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const pattern = /<item[\s>][\s\S]*?<\/item>/g;
  for (const match of xml.matchAll(pattern)) {
    blocks.push(match[0]);
    if (blocks.length >= NEWS_MAX_ITEMS_PER_FEED) {
      break;
    }
  }
  return blocks;
}

function tagText(block: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = pattern.exec(block);
  return match === null ? null : (match[1] ?? null);
}

function attrOf(block: string, tag: string, attribute: string): string | null {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["']`, 'i');
  const match = pattern.exec(block);
  return match === null ? null : (match[1] ?? null);
}

function absoluteUrl(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = decodeEntities(stripCdata(raw)).trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageOf(block: string): string | null {
  const direct =
    attrOf(block, 'enclosure', 'url') ??
    attrOf(block, 'media:content', 'url') ??
    attrOf(block, 'media:thumbnail', 'url');
  const fromDirect = absoluteUrl(direct);
  if (fromDirect !== null) {
    return fromDirect;
  }
  const description = tagText(block, 'description');
  if (description === null) {
    return null;
  }
  const img = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(description);
  return img === null ? null : absoluteUrl(img[1] ?? null);
}

function publishedOf(block: string): string | null {
  const raw = tagText(block, 'pubDate') ?? tagText(block, 'published') ?? tagText(block, 'updated');
  if (raw === null) {
    return null;
  }
  const parsed = Date.parse(plainText(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseFeed(xml: string): RawFeedItem[] {
  if (!isSafeFeedDocument(xml)) {
    return [];
  }
  const items: RawFeedItem[] = [];
  for (const block of extractBlocks(xml)) {
    const title = tagText(block, 'title');
    const link = tagText(block, 'link');
    if (title === null || link === null) {
      continue;
    }
    const cleanTitle = plainText(title);
    const cleanLink = absoluteUrl(link);
    if (cleanTitle.length === 0 || cleanLink === null) {
      continue;
    }
    const description = tagText(block, 'description');
    items.push({
      title: cleanTitle.slice(0, 300),
      link: cleanLink,
      publishedAt: publishedOf(block),
      summary: description === null ? '' : plainText(description),
      imageUrl: imageOf(block),
    });
    if (items.length >= NEWS_MAX_ITEMS) {
      break;
    }
  }
  return items;
}