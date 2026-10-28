import { describe, expect, it } from 'vitest';
import type { ReportCategory } from '@hadir/contracts';
import {
  DEBOUNCE_MS,
  DRAFT_TTL_MS,
  MAX_SERIALIZED,
  MIN_SAVE_LENGTH,
  PHOTO_TTL_MS,
  decodeDraft,
  draftAgeText,
  draftSummary,
  encodeDraft,
  hasContent,
  photoStillValid,
  withoutStalePhoto,
  type DraftInput,
  type ReportDraft,
} from './draft';

const NOW = Date.parse('2026-10-28T09:00:00.000Z');
const PHOTO_ID = '0192f0d0-0000-7000-8000-000000000001';

function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    stopCode: 'BJM-014',
    category: 'service_wait',
    text: 'Bus tidak datang lebih dari empat puluh menit di halte ini.',
    photoUploadId: null,
    photoSavedAt: null,
    ...overrides,
  };
}

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return { ...input(), savedAt: NOW, ...overrides };
}

describe('constants', () => {
  it('follows the documented two second debounce', () => {
    expect(DEBOUNCE_MS).toBe(2000);
  });

  it('keeps the draft well inside a localStorage-sized payload', () => {
    expect(MAX_SERIALIZED).toBeLessThanOrEqual(4096);
  });

  it('expires the draft sooner than a week', () => {
    expect(DRAFT_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('expires the photo pointer before the server upload TTL', () => {
    expect(PHOTO_TTL_MS).toBeLessThan(15 * 60 * 1000);
  });
});

describe('hasContent', () => {
  it('is false for an untouched form', () => {
    expect(hasContent({ stopCode: null, category: null, text: '', photoUploadId: null, photoSavedAt: null })).toBe(false);
    expect(hasContent({ stopCode: null, category: null, text: '   ', photoUploadId: null, photoSavedAt: null })).toBe(false);
  });

  it('is true once the user types or makes a choice', () => {
    expect(hasContent(input())).toBe(true);
    expect(hasContent({ ...input(), text: 'a' })).toBe(true);
    expect(hasContent({ ...input(), text: '', category: 'other' })).toBe(true);
    expect(hasContent({ ...input(), text: '', category: null })).toBe(true);
  });

  it('accepts a single character', () => {
    expect(MIN_SAVE_LENGTH).toBe(1);
  });
});

describe('photoStillValid', () => {
  it('accepts a fresh upload pointer', () => {
    expect(photoStillValid(draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW - 60_000 }), NOW)).toBe(true);
  });

  it('rejects a pointer older than the local margin', () => {
    expect(
      photoStillValid(draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW - PHOTO_TTL_MS - 1 }), NOW),
    ).toBe(false);
  });

  it('rejects a pointer stamped in the future', () => {
    expect(photoStillValid(draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW + 120_000 }), NOW)).toBe(
      false,
    );
  });

  it('rejects a missing pointer', () => {
    expect(photoStillValid(draft(), NOW)).toBe(false);
    expect(photoStillValid(draft({ photoSavedAt: NOW }), NOW)).toBe(false);
  });
});

describe('withoutStalePhoto', () => {
  it('keeps a valid pointer untouched', () => {
    const live = draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW });
    expect(withoutStalePhoto(live, NOW)).toBe(live);
  });

  it('clears an expired pointer', () => {
    const stale = draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW - PHOTO_TTL_MS - 1 });
    const cleaned = withoutStalePhoto(stale, NOW);
    expect(cleaned.photoUploadId).toBeNull();
    expect(cleaned.photoSavedAt).toBeNull();
    expect(cleaned.text).toBe(stale.text);
  });
});

describe('encodeDraft', () => {
  it('stamps the save time', () => {
    const raw = encodeDraft(input(), NOW);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).savedAt).toBe(NOW);
  });

  it('stamps the photo time when a pointer is present', () => {
    const raw = encodeDraft(input({ photoUploadId: PHOTO_ID }), NOW);
    const parsed = JSON.parse(raw as string);
    expect(parsed.photoSavedAt).toBe(NOW);
  });

  it('keeps the caller photo timestamp', () => {
    const earlier = NOW - 120_000;
    const raw = encodeDraft(input({ photoUploadId: PHOTO_ID, photoSavedAt: earlier }), NOW);
    expect(JSON.parse(raw as string).photoSavedAt).toBe(earlier);
  });

  it('caps the text at the report limit', () => {
    const raw = encodeDraft(input({ text: 'a'.repeat(5000) }), NOW);
    expect(JSON.parse(raw as string).text).toHaveLength(2000);
  });
});

describe('decodeDraft', () => {
  it('round-trips a draft', () => {
    const original = input();
    const decoded = decodeDraft(encodeDraft(original, NOW), NOW);
    expect(decoded).toEqual({ ...original, photoSavedAt: null, savedAt: NOW });
  });

  it('round-trips a draft with a live photo pointer', () => {
    const decoded = decodeDraft(encodeDraft(input({ photoUploadId: PHOTO_ID }), NOW), NOW);
    expect(decoded?.photoUploadId).toBe(PHOTO_ID);
    expect(decoded?.photoSavedAt).toBe(NOW);
  });

  it('drops an expired photo pointer on restore', () => {
    const raw = encodeDraft(input({ photoUploadId: PHOTO_ID }), NOW - PHOTO_TTL_MS - 1);
    const decoded = decodeDraft(raw, NOW);
    expect(decoded?.photoUploadId).toBeNull();
  });

  it('rejects nothing, empty, and oversized payloads', () => {
    expect(decodeDraft(null, NOW)).toBeNull();
    expect(decodeDraft('', NOW)).toBeNull();
    expect(decodeDraft('x'.repeat(MAX_SERIALIZED + 1), NOW)).toBeNull();
  });

  it('rejects broken JSON and non-objects', () => {
    expect(decodeDraft('{', NOW)).toBeNull();
    expect(decodeDraft('[]', NOW)).toBeNull();
    expect(decodeDraft('null', NOW)).toBeNull();
  });

  it('rejects an expired draft', () => {
    const raw = encodeDraft(input(), NOW - DRAFT_TTL_MS - 1);
    expect(decodeDraft(raw, NOW)).toBeNull();
  });

  it('rejects a draft stamped in the future', () => {
    const raw = encodeDraft(input(), NOW + 120_000);
    expect(decodeDraft(raw, NOW)).toBeNull();
  });

  it('rejects an unknown stop code', () => {
    expect(decodeDraft(JSON.stringify({ ...draft(), stopCode: 'bukan kode!' }), NOW)).toBeNull();
  });

  it('rejects an unknown category', () => {
    expect(decodeDraft(JSON.stringify({ ...draft(), category: 'bencana' }), NOW)).toBeNull();
  });

  it('accepts the null stop and category', () => {
    const decoded = decodeDraft(
      JSON.stringify({ ...draft(), stopCode: null, category: null }),
      NOW,
    );
    expect(decoded?.stopCode).toBeNull();
    expect(decoded?.category).toBeNull();
  });

  it('rejects a non-string text', () => {
    expect(decodeDraft(JSON.stringify({ ...draft(), text: 42 }), NOW)).toBeNull();
  });

  it('rejects a photo pointer that is not a uuid', () => {
    expect(
      decodeDraft(JSON.stringify({ ...draft(), photoUploadId: '../etc', photoSavedAt: NOW }), NOW),
    ).toBeNull();
  });

  it('rejects a pointer without a timestamp and vice versa', () => {
    expect(
      decodeDraft(JSON.stringify({ ...draft(), photoUploadId: PHOTO_ID, photoSavedAt: null }), NOW),
    ).toBeNull();
    expect(
      decodeDraft(JSON.stringify({ ...draft(), photoUploadId: null, photoSavedAt: NOW }), NOW),
    ).toBeNull();
  });

  it('rejects an empty draft', () => {
    const empty = {
      stopCode: null,
      category: null,
      text: '   ',
      photoUploadId: null,
      photoSavedAt: null,
      savedAt: NOW,
    };
    expect(decodeDraft(JSON.stringify(empty), NOW)).toBeNull();
  });

  it('normalises the stop code to upper case', () => {
    const decoded = decodeDraft(JSON.stringify({ ...draft(), stopCode: 'bjm-014' }), NOW);
    expect(decoded?.stopCode).toBe('BJM-014');
  });

  it('caps text that exceeds the report limit but stays inside the payload cap', () => {
    const decoded = decodeDraft(JSON.stringify({ ...draft(), text: 'a'.repeat(2_500) }), NOW);
    expect(decoded?.text).toHaveLength(2000);
  });

  it('rejects a payload that grew beyond the serialized cap', () => {
    const decoded = decodeDraft(JSON.stringify({ ...draft(), text: 'a'.repeat(9000) }), NOW);
    expect(decoded).toBeNull();
  });

  it('survives every field being the wrong type', () => {
    const hostile = {
      stopCode: 12,
      category: 34,
      text: null,
      photoUploadId: [],
      photoSavedAt: {},
      savedAt: 'kemarin',
    };
    expect(decodeDraft(JSON.stringify(hostile), NOW)).toBeNull();
  });
});

describe('draftSummary', () => {
  it('counts characters, category, and photo', () => {
    const text = draftSummary(draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW }), NOW);
    expect(text).toContain('karakter');
    expect(text).toContain('kategori');
    expect(text).toContain('foto');
  });

  it('says empty when nothing was filled', () => {
    expect(draftSummary(draft({ text: '   ' }), NOW)).toBe('kategori sudah dipilih');
    expect(
      draftSummary({ ...draft({ text: '' }), category: null, stopCode: null }, NOW),
    ).toBe('draf kosong');
  });

  it('does not claim a photo that expired', () => {
    const stale = draft({ photoUploadId: PHOTO_ID, photoSavedAt: NOW - PHOTO_TTL_MS - 1 });
    expect(draftSummary(stale, NOW)).not.toContain('foto');
  });
});

describe('draftAgeText', () => {
  it('describes a fresh save', () => {
    expect(draftAgeText(NOW - 5_000, NOW)).toBe('disimpan beberapa detik lalu');
    expect(draftAgeText(NOW - 12 * 60_000, NOW)).toBe('disimpan 12 menit lalu');
    expect(draftAgeText(NOW - 3 * 3_600_000, NOW)).toBe('disimpan 3 jam lalu');
    expect(draftAgeText(NOW - 2 * 86_400_000, NOW)).toBe('disimpan 2 hari lalu');
  });

  it('refuses to invent a time', () => {
    expect(draftAgeText(NOW + 60_000, NOW)).toBe('waktu simpan tidak diketahui');
    expect(draftAgeText(Number.NaN, NOW)).toBe('waktu simpan tidak diketahui');
  });
});

describe('category coverage', () => {
  it('accepts every contract category', () => {
    const categories: readonly ReportCategory[] = [
      'service_wait',
      'service_no_show',
      'service_full',
      'stop_facility',
      'stop_cleanliness',
      'stop_safety',
      'route_info',
      'accessibility',
      'other',
    ];
    for (const category of categories) {
      expect(decodeDraft(JSON.stringify({ ...draft(), category }), NOW)?.category).toBe(category);
    }
  });
});
