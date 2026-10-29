import { describe, expect, it } from 'vitest';
import type { Estimate } from '@hadir/contracts';
import {
  ciText,
  compareToPromise,
  estimateReadout,
  estimateStatus,
  formatMinuteValue,
  gapText,
  knownWarnings,
  rateText,
  readEstimateWindow,
  sampleText,
  unknownWarnings,
  windowLabel,
} from './estimate';

function estimateOf(overrides: Partial<Estimate> = {}, metrics: Partial<Estimate['metrics']> = {}): Estimate {
  return {
    stopId: '018bcfe5-0000-4000-8000-000000000002',
    stopCode: 'BMS-A12',
    routeId: null,
    window: { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z', label: '7d' },
    metrics: {
      n: 34,
      nEffective: 21.4,
      medianMin: 21,
      meanMin: 22.3,
      rmstMin: 24.1,
      p95Min: 41,
      ewtMin: 13.5,
      abandonRate: 0.18,
      fullRate: 0.06,
      cifAbandon: 0.24,
      timeToBoardRmstMin: 26.9,
      ci: { low: 18, high: 25, level: 0.9, method: 'cluster-bootstrap' },
      ...metrics,
    },
    promise: { headwayMin: 15, source: 'headway koridor', sourceUrl: 'https://contoh.go.id/spm' },
    evidence: 'strong',
    direction: 'excess',
    message: '34 catatan. Bukti cukup kuat untuk dibandingkan dengan janji layanan.',
    warnings: [],
    simulated: false,
    sample: { days: 6, devices: 12, clusters: 9, designEffect: 1.8, thresholdMin: 18.75 },
    computedAt: '2026-10-26T04:00:00.000Z',
    methodVersion: 'est-2026-10-26.1',
    ...overrides,
  };
}

describe('estimateStatus', () => {
  it('mengutamakan arah tidak ada kelebihan di atas level none', () => {
    const status = estimateStatus('none', 'no_excess');
    expect(status.key).toBe('no_excess');
    expect(status.label).toContain('Tidak ada kelebihan');
  });

  it('memakai label level untuk arah selebihnya', () => {
    expect(estimateStatus('strong', 'excess').label).toBe('Bukti kuat');
    expect(estimateStatus('indication', 'inconclusive').label).toBe('Indikasi');
    expect(estimateStatus('none', 'inconclusive').label).toBe('Belum cukup data');
    expect(estimateStatus('field_verified', 'excess').label).toBe('Terverifikasi lapangan');
  });

  it('menyatakan bahwa no_excess bukan bukti kepatuhan penuh', () => {
    expect(estimateStatus('none', 'no_excess').detail).toContain('bukan bukti layanan patuh');
  });
});

describe('estimateReadout', () => {
  it('menyembunyikan angka saat belum ada catatan', () => {
    const readout = estimateReadout(estimateOf({}, { n: 0, medianMin: null, ci: null }));
    expect(readout.kind).toBe('empty');
    expect(readout.minutes).toBeNull();
  });

  it('menyembunyikan angka saat sampel masih kecil', () => {
    const readout = estimateReadout(estimateOf({ warnings: ['small_n'] }, { n: 6 }));
    expect(readout.kind).toBe('insufficient');
    expect(readout.minutes).toBeNull();
    expect(readout.n).toBe(6);
  });

  it('menyembunyikan angka saat median tidak tersedia', () => {
    const readout = estimateReadout(estimateOf({}, { medianMin: null }));
    expect(readout.kind).toBe('insufficient');
  });

  it('menampilkan angka beserta interval saat sampel memadai', () => {
    const readout = estimateReadout(estimateOf());
    expect(readout.kind).toBe('measured');
    expect(readout.minutes).toBe(21);
    expect(ciText(readout)).toBe('Interval 90%: 18–25 menit');
  });

  it('jujur saat interval tidak tersedia meski angka ada', () => {
    const readout = estimateReadout(estimateOf({}, { ci: null }));
    expect(readout.kind).toBe('measured');
    expect(ciText(readout)).toBeNull();
  });

  it('meneruskan pesan server apa adanya', () => {
    const message = 'Pesan khusus dari server.';
    expect(estimateReadout(estimateOf({ message })).message).toBe(message);
  });
});

describe('compareToPromise', () => {
  it('menghitung selisih terhadap ambang, bukan terhadap janji mentah', () => {
    const comparison = compareToPromise(estimateOf());
    expect(comparison).not.toBeNull();
    if (comparison === null) {
      return;
    }
    expect(comparison.thresholdMin).toBe(18.75);
    expect(comparison.gapMin).toBe(2.3);
    expect(gapText(comparison)).toBe('2 menit di atas ambang');
  });

  it('mengembalikan null saat ambang tidak diketahui', () => {
    const base = estimateOf();
    const withoutThreshold: Estimate = {
      ...base,
      sample: { ...base.sample, thresholdMin: null },
      promise: null,
    };
    expect(compareToPromise(withoutThreshold)).toBeNull();
  });

  it('menulis selisih di bawah ambang tanpa tanda minus', () => {
    const base = estimateOf();
    const comparison = compareToPromise({
      ...base,
      metrics: { ...base.metrics, medianMin: 12 },
      direction: 'no_excess',
    });
    expect(comparison?.gapMin).toBe(-6.8);
    if (comparison !== null) {
      expect(gapText(comparison)).toBe('7 menit di bawah ambang');
    }
  });
});

describe('warning', () => {
  it('menerjemahkan kode yang dikenal dan membuang yang tidak', () => {
    const known = knownWarnings(['small_n', 'masa_depan']);
    expect(known).toHaveLength(1);
    expect(known[0]?.text).toContain('ambang minimum');
    expect(unknownWarnings(['small_n', 'masa_depan'])).toEqual(['masa_depan']);
  });

  it('menerjemahkan seluruh kode yang dipakai estimator', () => {
    const codes = [
      'no_data',
      'small_n',
      'small_cluster_count',
      'clustered_data',
      'p95_unstable',
      'trust_sensitive',
      'low_trust_dominant',
    ];
    expect(knownWarnings(codes)).toHaveLength(codes.length);
    expect(unknownWarnings(codes)).toHaveLength(0);
  });
});

describe('format', () => {
  it('tidak menampilkan desimal palsu pada menit', () => {
    expect(formatMinuteValue(21.4)).toBe('21');
    expect(formatMinuteValue(null)).toBe('—');
    expect(formatMinuteValue(Number.NaN)).toBe('—');
  });

  it('menampilkan laju sebagai persen tanpa desimal', () => {
    expect(rateText(0.184)).toBe('18%');
    expect(rateText(null)).toBe('—');
  });

  it('menyusun teks sampel dari angka server', () => {
    expect(sampleText(estimateOf().metrics, 6, 12)).toBe('n=34 · 6 hari · 12 perangkat');
  });
});

describe('jendela waktu', () => {
  it('menerima hanya dua nilai yang didukung server', () => {
    expect(readEstimateWindow('30d')).toBe('30d');
    expect(readEstimateWindow('7d')).toBe('7d');
    expect(readEstimateWindow('90d')).toBe('7d');
    expect(readEstimateWindow(undefined)).toBe('7d');
  });

  it('memberi label yang bisa dibaca', () => {
    expect(windowLabel('7d')).toBe('7 hari terakhir');
    expect(windowLabel('30d')).toBe('30 hari terakhir');
  });
});
