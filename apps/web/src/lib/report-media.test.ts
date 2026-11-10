import { describe, expect, it } from 'vitest';
import type { ReportMediaItem } from '@hadir/contracts';
import { mediaCaption, mediaMimeLabel, reportMediaListSchema } from './report-media';

function item(overrides: Partial<ReportMediaItem> = {}): ReportMediaItem {
  return {
    mediaId: '0192f0d0-0000-7000-8000-000000000001',
    mime: 'image/jpeg',
    width: 1280,
    height: 960,
    url: '/v1/reports/LPR-2026-000123/media/0192f0d0-0000-7000-8000-000000000001',
    ...overrides,
  };
}

describe('report media guard', () => {
  it('accepts an empty list and a normal attachment', () => {
    expect(reportMediaListSchema.safeParse([]).success).toBe(true);
    expect(reportMediaListSchema.safeParse([item()]).success).toBe(true);
  });

  it('rejects unsupported mime types', () => {
    expect(reportMediaListSchema.safeParse([item({ mime: 'image/gif' as never })]).success).toBe(
      false,
    );
    expect(reportMediaListSchema.safeParse([item({ mime: 'application/pdf' as never })]).success).toBe(
      false,
    );
  });

  it('rejects zero sized images', () => {
    expect(reportMediaListSchema.safeParse([item({ width: 0 })]).success).toBe(false);
    expect(reportMediaListSchema.safeParse([item({ height: 0 })]).success).toBe(false);
  });

  it('rejects more than five attachments', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      item({ mediaId: `0192f0d0-0000-7000-8000-00000000000${String(index)}` }),
    );
    expect(reportMediaListSchema.safeParse(many).success).toBe(false);
  });

  it('rejects non arrays and broken rows', () => {
    expect(reportMediaListSchema.safeParse(null).success).toBe(false);
    expect(reportMediaListSchema.safeParse({ items: [] }).success).toBe(false);
    expect(reportMediaListSchema.safeParse([{ mediaId: 'x' }]).success).toBe(false);
  });
});

describe('report media labels', () => {
  it('numbers captions and keeps the pixel size', () => {
    expect(mediaCaption(item(), 0)).toBe('Lampiran 1 · 1280×960');
    expect(mediaCaption(item(), 2)).toBe('Lampiran 3 · 1280×960');
  });

  it('names the three allowed formats', () => {
    expect(mediaMimeLabel('image/jpeg')).toBe('JPEG');
    expect(mediaMimeLabel('image/png')).toBe('PNG');
    expect(mediaMimeLabel('image/webp')).toBe('WebP');
  });
});
