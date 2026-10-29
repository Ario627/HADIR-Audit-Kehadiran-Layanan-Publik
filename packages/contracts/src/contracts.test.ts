import { describe, expect, it } from 'vitest';
import {
  CreateReportInput,
  ListStopsQuery,
  QrQuery,
  StartEpisodeInput,
} from './index';

const CLIENT_EVENT_ID = '0192f0c4-0000-7000-8000-000000000001';
const CLIENT_EVENT_ID_V4 = '0192f0c4-0000-4000-8000-000000000001';
const STARTED_AT = '2026-10-25T10:00:00.000Z';

describe('StartEpisodeInput', () => {
  it('accepts a QR episode with a signed proof', () => {
    const result = StartEpisodeInput.safeParse({
      stopCode: 'BMS-A12',
      startMode: 'qr',
      clientStartedAt: STARTED_AT,
      clientEventId: CLIENT_EVENT_ID,
      qr: { epoch: '202610', keyId: 'k1', signature: 'a'.repeat(22) },
    });
    expect(result.success).toBe(true);
  });

  it('requires a QR proof for QR mode', () => {
    const result = StartEpisodeInput.safeParse({
      stopCode: 'BMS-A12',
      startMode: 'qr',
      clientStartedAt: STARTED_AT,
      clientEventId: CLIENT_EVENT_ID,
    });
    expect(result.success).toBe(false);
  });

  it('requires both buckets for GPS mode', () => {
    const result = StartEpisodeInput.safeParse({
      stopCode: 'BMS-A12',
      startMode: 'gps_nearby',
      clientStartedAt: STARTED_AT,
      clientEventId: CLIENT_EVENT_ID,
      distanceBucket: '0-50',
    });
    expect(result.success).toBe(false);
  });

  it('rejects hidden coordinates', () => {
    const result = StartEpisodeInput.safeParse({
      stopCode: 'BMS-A12',
      startMode: 'qr',
      clientStartedAt: STARTED_AT,
      clientEventId: CLIENT_EVENT_ID,
      qr: { epoch: '202610', keyId: 'k1', signature: 'a'.repeat(22) },
      lat: -7.4,
      lon: 109.2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a UUID v4 client event id', () => {
    const result = StartEpisodeInput.safeParse({
      stopCode: 'BMS-A12',
      startMode: 'qr',
      clientStartedAt: STARTED_AT,
      clientEventId: CLIENT_EVENT_ID_V4,
      qr: { epoch: '202610', keyId: 'k1', signature: 'a'.repeat(22) },
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateReportInput', () => {
  it('requires a meaningful report body and a valid email', () => {
    const short = CreateReportInput.safeParse({
      category: 'stop_facility',
      stopCode: 'BMS-A12',
      text: 'Atap bocor',
      clientEventId: CLIENT_EVENT_ID,
    });
    expect(short.success).toBe(false);

    const invalidEmail = CreateReportInput.safeParse({
      category: 'stop_facility',
      stopCode: 'BMS-A12',
      text: 'Atap halte bocor sejak hujan kemarin.',
      contactEmail: 'not-an-email',
      clientEventId: CLIENT_EVENT_ID,
    });
    expect(invalidEmail.success).toBe(false);
  });

  it('accepts a valid report', () => {
    const result = CreateReportInput.safeParse({
      category: 'stop_facility',
      stopCode: 'BMS-A12',
      text: 'Atap halte bocor sejak hujan kemarin.',
      contactEmail: 'warga@example.com',
      clientEventId: CLIENT_EVENT_ID,
    });
    expect(result.success).toBe(true);
  });
});

describe('query contracts', () => {
  it('accepts a valid Indonesian bbox and rejects reversed bounds', () => {
    expect(
      ListStopsQuery.safeParse({ bbox: '109.1,-7.5,109.3,-7.3' }).success,
    ).toBe(true);
    expect(
      ListStopsQuery.safeParse({ bbox: '109.3,-7.5,109.1,-7.3' }).success,
    ).toBe(false);
  });

  it('enforces QR query shape', () => {
    expect(
      QrQuery.safeParse({ e: '202610', k: 'k1', s: 'a'.repeat(22) }).success,
    ).toBe(true);
    expect(QrQuery.safeParse({ e: '202610', k: 'K1', s: 'a'.repeat(22) }).success).toBe(
      false,
    );
  });
});