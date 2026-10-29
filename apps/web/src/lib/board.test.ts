import { describe, expect, it } from 'vitest';
import type { CoverageSummaryItem, StopSummary } from '@hadir/contracts';
import {
  buildRows,
  readFilter,
  readPeriod,
  readQueryParam,
  summarizeRows,
  toSearchParams,
  viewRows,
} from './board';

const STOP_A: StopSummary = {
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

const STOP_B: StopSummary = {
  id: '018bcfe5-0000-4000-8000-000000000002',
  code: 'BMS-B07',
  name: 'Halte Pasar Wage',
  location: { lat: -7.41, lon: 109.21 },
  status: 'active',
  isDemo: true,
  routes: [
    {
      id: '018bcfe5-0000-4000-8000-0000000000bb',
      code: 'K2B',
      name: 'Koridor 2B',
      promisedHeadwayPeakMin: null,
      headwaySourceUrl: null,
    },
  ],
};

const COVERAGE_A: CoverageSummaryItem = {
  stopId: STOP_A.id,
  stopCode: STOP_A.code,
  stopName: STOP_A.name,
  n: 34,
  devices: 12,
  days: 6,
  clusters: 9,
  hoursCovered: 8,
  level: 'strong',
};

describe('buildRows', () => {
  it('memasangkan cakupan lewat stopId dan mengosongkan yang tidak terukur', () => {
    const rows = buildRows([STOP_A, STOP_B], [COVERAGE_A]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.episodes).toBe(34);
    expect(rows[0]?.level).toBe('strong');
    expect(rows[1]?.episodes).toBe(0);
    expect(rows[1]?.level).toBe('none');
  });

  it('mengambil janji headway dan menolak sumber yang tidak aman', () => {
    const rows = buildRows([STOP_A, STOP_B], []);
    expect(rows[0]?.promiseMinutes).toBe(15);
    expect(rows[0]?.promiseSource).toBe('https://dinhub.example.go.id/spm');
    expect(rows[1]?.promiseMinutes).toBeNull();
    expect(rows[1]?.promiseSource).toBeNull();

    const unsafe = buildRows(
      [
        {
          ...STOP_A,
          routes: [{ ...STOP_A.routes[0]!, headwaySourceUrl: 'javascript:alert(1)' }],
        },
      ],
      [],
    );
    expect(unsafe[0]?.promiseSource).toBeNull();
  });

  it('menandai halte simulasi agar tidak terbaca sebagai data lapangan', () => {
    const rows = buildRows([STOP_B], []);
    expect(rows[0]?.isDemo).toBe(true);
  });
});

describe('viewRows', () => {
  const rows = buildRows([STOP_A, STOP_B], [COVERAGE_A]);

  it('menyaring berdasarkan kode koridor dan level bukti', () => {
    expect(viewRows(rows, { q: 'k2b', sort: 'measured', level: 'all' })).toHaveLength(1);
    expect(viewRows(rows, { q: '', sort: 'measured', level: 'strong' })).toHaveLength(1);
    expect(viewRows(rows, { q: '', sort: 'measured', level: 'none' })).toHaveLength(1);
  });

  it('mengurutkan data terbanyak lebih dulu lalu nama', () => {
    const sorted = viewRows(rows, { q: '', sort: 'measured', level: 'all' });
    expect(sorted.map((row) => row.code)).toEqual(['BMS-A12', 'BMS-B07']);
  });

  it('tidak mengubah larik masukan saat mengurutkan', () => {
    const input = buildRows([STOP_A, STOP_B], [COVERAGE_A]);
    viewRows(input, { q: '', sort: 'code', level: 'all' });
    expect(input.map((row) => row.code)).toEqual(['BMS-A12', 'BMS-B07']);
  });
});

describe('summarizeRows', () => {
  it('menghitung halte terukur, episode, dan halte yang punya indikasi', () => {
    const totals = summarizeRows(buildRows([STOP_A, STOP_B], [COVERAGE_A]));
    expect(totals).toEqual({ listed: 2, measured: 1, withIndication: 1, episodes: 34 });
  });

  it('tidak menghitung halte tanpa data sebagai punya indikasi', () => {
    const totals = summarizeRows(buildRows([STOP_A, STOP_B], []));
    expect(totals.withIndication).toBe(0);
    expect(totals.measured).toBe(0);
  });
});

describe('parameter pencarian', () => {
  it('menolak kata kunci yang tidak memenuhi batas', () => {
    expect(readQueryParam('a')).toBe('');
    expect(readQueryParam('   x   ')).toBe('');
    expect(readQueryParam(undefined)).toBe('');
    expect(readQueryParam(' halte ')).toBe('halte');
    expect(readQueryParam('x'.repeat(101))).toBe('');
  });

  it('jatuh ke jendela 7 hari untuk nilai periode yang tidak dikenal', () => {
    expect(readPeriod('30d')).toBe('30d');
    expect(readPeriod('90d')).toBe('7d');
    expect(readPeriod(undefined)).toBe('7d');
  });

  it('mengabaikan kunci tak dikenal dan memakai nilai bawaan', () => {
    expect(readFilter({ q: 'halte', level: 'bogus', sort: 'bogus', period: 'bogus' })).toEqual({
      q: 'halte',
      sort: 'measured',
      level: 'all',
      period: '7d',
    });
  });

  it('tidak menulis nilai bawaan ke URL', () => {
    expect(toSearchParams({ q: '', sort: 'measured', level: 'all', period: '7d' })).toEqual({});
    expect(toSearchParams({ q: 'ump', sort: 'code', level: 'strong', period: '30d' })).toEqual({
      q: 'ump',
      sort: 'code',
      level: 'strong',
      period: '30d',
    });
  });
});
