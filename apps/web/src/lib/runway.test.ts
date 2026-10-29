import { describe, expect, it } from 'vitest';
import type { Runway } from '@hadir/contracts';
import {
  daysRemainingText,
  decisionText,
  eventKindLabel,
  horizonNote,
  runwayStatusLabel,
  sortedEvents,
  TAPE_HORIZON_DAYS,
  TAPE_TICK_DAYS,
  tapeMarker,
  tapeTicks,
  urgencyOf,
} from './runway';

const RUNWAY: Runway = {
  routeId: '018bcfe5-0000-4000-8000-0000000000aa',
  routeCode: 'K3A',
  routeName: 'Koridor 3A',
  status: 'funded',
  urgency: 'watch',
  fundedUntil: '2026-12-31',
  daysRemaining: 64,
  sourceUrl: 'https://contoh.go.id/rup',
  decisionDoc: 'Keputusan Dinhub 12/2026',
  decisionDate: '2026-01-04',
  note: null,
  sanctions: [],
  events: [
    { seq: 2, kind: 'funded', note: 'Dana dicairkan.', sourceUrl: 'https://contoh.go.id/rup', occurredAt: '2026-02-01T00:00:00.000Z' },
    { seq: 1, kind: 'announced', note: 'Diumumkan.', sourceUrl: 'https://contoh.go.id/rup', occurredAt: '2026-01-04T00:00:00.000Z' },
  ],
  disclaimer: 'Tanggal adalah batas pendanaan yang dilaporkan, bukan prediksi.',
  simulated: false,
  computedAt: '2026-10-28T00:00:00.000Z',
};

describe('urgencyOf', () => {
  it('memberi label dan nada untuk tiap band', () => {
    expect(urgencyOf('expired').tone).toBe('alert');
    expect(urgencyOf('critical').label).toBe('Mendesak');
    expect(urgencyOf('watch').tone).toBe('neutral');
    expect(urgencyOf('none').label).toBe('Tanpa tenggat');
  });

  it('menolak band di luar kontrak', () => {
    expect(() => urgencyOf('panik' as never)).toThrow(/tidak dikenal/);
  });

  it('tidak menyimpulkan penghentian layanan dari tanggal', () => {
    expect(urgencyOf('expired').detail).toContain('Bukan prediksi');
  });
});

describe('label status dan event', () => {
  it('menerjemahkan status pendanaan', () => {
    expect(runwayStatusLabel('funded')).toBe('Dana terjamin');
    expect(runwayStatusLabel('unknown')).toBe('Tidak diketahui');
  });

  it('memakai label netral untuk jenis event yang belum dikenal', () => {
    expect(eventKindLabel('budget_decided')).toBe('Anggaran diputuskan');
    expect(eventKindLabel('dari_masa_depan')).toBe('Pembaruan');
  });
});

describe('daysRemainingText', () => {
  it('membedakan sisa, hari ini, lewat, dan tidak diketahui', () => {
    expect(daysRemainingText(64)).toBe('64 hari lagi');
    expect(daysRemainingText(0)).toBe('Berakhir hari ini');
    expect(daysRemainingText(-3)).toBe('Lewat 3 hari');
    expect(daysRemainingText(null)).toBe('Tidak diketahui');
  });
});

describe('pita waktu', () => {
  it('memetakan sisa hari ke posisi pita dan menjepit di luar rentang', () => {
    expect(tapeMarker(null)).toBeNull();
    expect(tapeMarker(-10)).toBe(0);
    expect(tapeMarker(0)).toBe(0);
    expect(tapeMarker(TAPE_HORIZON_DAYS)).toBe(100);
    expect(tapeMarker(TAPE_HORIZON_DAYS * 3)).toBe(100);
    expect(tapeMarker(TAPE_HORIZON_DAYS / 2)).toBe(50);
  });

  it('menghasilkan tick yang merata dari 0 sampai 100', () => {
    const ticks = tapeTicks();
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(100);
    expect(ticks).toHaveLength(TAPE_HORIZON_DAYS / TAPE_TICK_DAYS + 1);
  });

  it('tidak bergantung pada jam perangkat', () => {
    expect(tapeMarker(64)).toBe(tapeMarker(64));
    expect(tapeMarker(64)).toBe(35.6);
  });
});

describe('decisionText', () => {
  it('menggabungkan tanggal dan dokumen bila keduanya ada', () => {
    expect(decisionText(RUNWAY)).toBe('Keputusan 2026-01-04: Keputusan Dinhub 12/2026');
  });

  it('menangani hanya salah satu', () => {
    expect(decisionText({ ...RUNWAY, decisionDate: null })).toBe('Keputusan: Keputusan Dinhub 12/2026');
    expect(decisionText({ ...RUNWAY, decisionDoc: null })).toBe('Keputusan tertanggal 2026-01-04');
  });

  it('mengembalikan null bila keduanya tidak ada', () => {
    expect(decisionText({ ...RUNWAY, decisionDoc: null, decisionDate: null })).toBeNull();
  });
});

describe('sortedEvents', () => {
  it('mengurutkan berdasarkan seq tanpa mengubah larik masukan', () => {
    const sorted = sortedEvents(RUNWAY.events);
    expect(sorted.map((event) => event.seq)).toEqual([1, 2]);
    expect(RUNWAY.events.map((event) => event.seq)).toEqual([2, 1]);
  });
});

describe('horizonNote', () => {
  it('menyatakan bahwa pita bukan ramalan', () => {
    expect(horizonNote()).toContain('bukan ramalan');
  });
});
