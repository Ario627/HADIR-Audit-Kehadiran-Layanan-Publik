import { describe, expect, it } from 'vitest';
import { coverageSummarySchema, methodologySchema, stopListSchema } from './guards';

const STOP = {
  id: '018bcfe5-0000-4000-8000-000000000001',
  code: 'BMS-A12',
  name: 'Halte UMP',
  location: { lat: -7.4, lon: 109.2 },
  status: 'active',
  isDemo: false,
  routes: [
    {
      id: '018bcfe5-0000-4000-8000-0000000000aa',
      code: 'K3A',
      name: 'Koridor 3A',
      promisedHeadwayPeakMin: 15,
      headwaySourceUrl: 'https://dinhub.example.go.id/spm',
    },
  ],
};

const COVERAGE = {
  period: '7d',
  stops: [
    {
      stopId: STOP.id,
      stopCode: STOP.code,
      stopName: STOP.name,
      n: 34,
      devices: 12,
      days: 6,
      clusters: 9,
      hoursCovered: 8,
      level: 'strong',
    },
  ],
};

const METHODOLOGY = {
  methodVersion: 'est-2026-10-26.1',
  updatedAt: '2026-10-26T00:00:00.000Z',
  primaryEstimand: 'Lama tunggu yang dialami.',
  secondaryEstimand: 'Lama tunggu sampai bus datang.',
  steps: [{ order: 1, title: 'Kumpulkan', detail: 'Episode valid dikumpulkan.' }],
  clusterUnit: 'hari-jam per halte',
  clusterRationale: 'Penunggu di jam yang sama menunggu bus yang sama.',
  thresholds: { excessMultiplier: 1.25, idealWaitFormula: 'headway / 2' },
  limitations: ['Angka mencerminkan penunggu yang mencatat.'],
  generatedAt: '2026-10-26T00:00:00.000Z',
};

describe('stopListSchema', () => {
  it('menerima daftar halte yang sesuai kontrak', () => {
    const parsed = stopListSchema.safeParse([STOP]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]?.routes[0]?.promisedHeadwayPeakMin).toBe(15);
    }
  });

  it('menolak bentuk yang bukan larik', () => {
    expect(stopListSchema.safeParse({ data: [STOP] }).success).toBe(false);
    expect(stopListSchema.safeParse(null).success).toBe(false);
  });

  it('menolak status halte yang tidak dikenal', () => {
    expect(stopListSchema.safeParse([{ ...STOP, status: 'deleted' }]).success).toBe(false);
  });

  it('menolak koordinat di luar rentang bumi', () => {
    expect(stopListSchema.safeParse([{ ...STOP, location: { lat: 91, lon: 0 } }]).success).toBe(
      false,
    );
  });

  it('tidak membiarkan properti tambahan masuk ke hasil', () => {
    const parsed = stopListSchema.safeParse([{ ...STOP, admin: true }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.hasOwn(parsed.data[0] ?? {}, 'admin')).toBe(false);
    }
  });
});

describe('coverageSummarySchema', () => {
  it('menerima ringkasan cakupan', () => {
    const parsed = coverageSummarySchema.safeParse(COVERAGE);
    expect(parsed.success).toBe(true);
  });

  it('menolak level bukti dan jam yang tidak masuk akal', () => {
    const badLevel = { ...COVERAGE, stops: [{ ...COVERAGE.stops[0], level: 'keren' }] };
    expect(coverageSummarySchema.safeParse(badLevel).success).toBe(false);

    const badHours = { ...COVERAGE, stops: [{ ...COVERAGE.stops[0], hoursCovered: 30 }] };
    expect(coverageSummarySchema.safeParse(badHours).success).toBe(false);
  });

  it('menolak jendela periode yang tidak dikenal', () => {
    expect(coverageSummarySchema.safeParse({ ...COVERAGE, period: '90d' }).success).toBe(false);
  });
});

describe('methodologySchema', () => {
  it('menerima metodologi lengkap', () => {
    expect(methodologySchema.safeParse(METHODOLOGY).success).toBe(true);
  });

  it('menolak metodologi tanpa batasan', () => {
    expect(methodologySchema.safeParse({ ...METHODOLOGY, limitations: [] }).success).toBe(false);
    expect(methodologySchema.safeParse({ ...METHODOLOGY, limitations: [''] }).success).toBe(false);
  });

  it('menolak versi metode kosong', () => {
    expect(methodologySchema.safeParse({ ...METHODOLOGY, methodVersion: '  ' }).success).toBe(false);
  });
});
