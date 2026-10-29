import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  EXPORT_HOURLY_LIMIT,
  EXPORT_ROW_LIMIT,
  EXPORT_TTL_HOURS,
  SIGNED_URL_TTL_MINUTES,
  exportFilename,
  exportFormatHint,
  exportFormatLabel,
  exportQuotaNote,
  exportRowLimitNote,
  exportStatusLabel,
  formatByteSize,
  formatRowCount,
  formatOptions,
  isDownloadable,
  saveBlob,
} from './export';

const READY = {
  exportId: '0192f0d0-0000-7000-8000-000000000001',
  status: 'ready' as const,
  format: 'csv' as const,
  rowCount: 42,
  byteSize: 2048,
  downloadUrl: '/v1/partner/exports/x/download?exp=1&sig=abc',
  expiresAt: '2026-10-29T00:00:00.000Z',
  createdAt: '2026-10-28T00:00:00.000Z',
};

describe('format labels', () => {
  it('names both supported formats', () => {
    expect(exportFormatLabel('csv')).toBe('CSV');
    expect(exportFormatLabel('open311')).toBe('Open311 JSON');
  });

  it('explains both formats', () => {
    expect(exportFormatHint('csv')).toContain('baris');
    expect(exportFormatHint('open311')).toContain('Open311');
  });

  it('exposes exactly two formats', () => {
    expect(formatOptions()).toEqual(['csv', 'open311']);
    expect(EXPORT_FORMATS).toHaveLength(2);
  });

  it('names every status', () => {
    for (const status of ['queued', 'running', 'ready', 'failed', 'expired'] as const) {
      expect(exportStatusLabel(status).length).toBeGreaterThan(5);
    }
  });
});

describe('isDownloadable', () => {
  it('is true only for a ready export with a link', () => {
    expect(isDownloadable(READY)).toBe(true);
  });

  it('is false when the link is missing', () => {
    expect(isDownloadable({ ...READY, downloadUrl: null })).toBe(false);
  });

  it('is false for any non-ready status', () => {
    for (const status of ['queued', 'running', 'failed', 'expired'] as const) {
      expect(isDownloadable({ ...READY, status })).toBe(false);
    }
  });
});

describe('formatByteSize', () => {
  it('uses bytes, kilobytes, and megabytes', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 kB');
    expect(formatByteSize(64 * 1024)).toBe('64 kB');
    expect(formatByteSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatByteSize(40 * 1024 * 1024)).toBe('40 MB');
  });

  it('refuses to invent a size', () => {
    expect(formatByteSize(null)).toBe('ukuran tidak dilaporkan');
    expect(formatByteSize(-1)).toBe('ukuran tidak dilaporkan');
    expect(formatByteSize(Number.NaN)).toBe('ukuran tidak dilaporkan');
  });
});

describe('formatRowCount', () => {
  it('groups thousands the Indonesian way', () => {
    expect(formatRowCount(1)).toBe('1 baris');
    expect(formatRowCount(4200)).toBe('4.200 baris');
  });

  it('refuses to invent a count', () => {
    expect(formatRowCount(null)).toBe('jumlah baris tidak dilaporkan');
    expect(formatRowCount(-3)).toBe('jumlah baris tidak dilaporkan');
  });
});

describe('exportFilename', () => {
  it('builds a short, extension-correct name', () => {
    expect(exportFilename('csv', '0192f0d0-0000-7000-8000-000000000001')).toBe(
      'hadir-ekspor-0192f0d0.csv',
    );
    expect(exportFilename('open311', 'abcdef12-3456-7890-abcd-ef1234567890')).toBe(
      'hadir-ekspor-abcdef12.json',
    );
  });

  it('falls back for an unusable identifier', () => {
    expect(exportFilename('csv', '../../etc/passwd')).toBe('hadir-ekspor-berkas.csv');
    expect(exportFilename('csv', '')).toBe('hadir-ekspor-berkas.csv');
  });
});

describe('saveBlob', () => {
  it('reports failure outside a browser instead of throwing', () => {
    expect(saveBlob(new Blob(['x']), 'a.csv')).toBe(false);
  });
});

describe('limits and notes', () => {
  it('matches the server guardrails', () => {
    expect(EXPORT_ROW_LIMIT).toBe(5000);
    expect(EXPORT_HOURLY_LIMIT).toBe(5);
    expect(EXPORT_TTL_HOURS).toBe(24);
    expect(SIGNED_URL_TTL_MINUTES).toBe(10);
  });

  it('states the row limit with a grouped number', () => {
    expect(exportRowLimitNote()).toContain('5.000');
  });

  it('states the quota', () => {
    expect(exportQuotaNote()).toContain('5 ekspor per jam');
    expect(exportQuotaNote()).toContain('24 jam');
    expect(exportQuotaNote()).toContain('10 menit');
  });
});
