import type { ReportMediaItem } from '@hadir/contracts';
import type { PayloadSchema } from './api';
import { isRecord, readCount, readText } from './guards';

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

function readMime(value: unknown): ReportMediaItem['mime'] | null {
  for (const mime of MIME_TYPES) {
    if (value === mime) {
      return mime;
    }
  }
  return null;
}

function toMediaItem(value: unknown): ReportMediaItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const mediaId = readText(value.mediaId, 64);
  const mime = readMime(value.mime);
  const width = readCount(value.width, 10_000);
  const height = readCount(value.height, 10_000);
  const url = readText(value.url, 500);
  if (mediaId === null || mime === null || width === null || height === null || url === null) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { mediaId, mime, width, height, url };
}

export const reportMediaListSchema: PayloadSchema<ReportMediaItem[]> = {
  safeParse(value: unknown) {
    if (!Array.isArray(value) || value.length > 5) {
      return { success: false };
    }
    const items: ReportMediaItem[] = [];
    for (const entry of value) {
      const parsed = toMediaItem(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export function mediaCaption(item: ReportMediaItem, index: number): string {
  return `Lampiran ${index + 1} · ${String(item.width)}×${String(item.height)}`;
}

export function mediaMimeLabel(mime: ReportMediaItem['mime']): string {
  switch (mime) {
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    case 'image/webp':
      return 'WebP';
  }
}
