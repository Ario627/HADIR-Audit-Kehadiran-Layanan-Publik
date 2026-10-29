import { describe, expect, it } from 'vitest';
import type { Episode } from '@hadir/contracts';
import {
  elapsedSeedMs,
  END_OUTCOMES,
  isClosedBySystem,
  outcomeCopy,
  presenceNote,
  startModeLabel,
  ticketFromEpisode,
} from './episode';

const EPISODE: Episode = {
  id: '018bcfe5-0000-7000-8000-000000000001',
  stopId: '018bcfe5-0000-4000-8000-000000000002',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  routeId: null,
  startMode: 'qr',
  presence: 'qr_only',
  trustWeight: 0.7,
  startedAt: '2026-10-26T03:42:00.000Z',
  endedAt: null,
  status: 'active',
  durationS: null,
  outcome: null,
  qualityFlags: [],
};

describe('outcomeCopy', () => {
  it('memberi label aksi dan pertanyaan konfirmasi untuk setiap hasil', () => {
    for (const outcome of END_OUTCOMES) {
      const copy = outcomeCopy(outcome);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.confirm.length).toBeGreaterThan(0);
      expect(copy.question).toContain('?');
    }
  });

  it('memakai nada berbeda antara naik, menyerah, dan penuh', () => {
    const tones = new Set(END_OUTCOMES.map((outcome) => outcomeCopy(outcome).tone));
    expect(tones.size).toBe(END_OUTCOMES.length);
  });

  it('menolak hasil di luar daftar', () => {
    expect(() => outcomeCopy('meledak' as never)).toThrow(/tidak dikenal/);
  });

  it('menandai pembatalan sebagai aksi berbahaya', () => {
    expect(outcomeCopy('cancelled').tone).toBe('danger');
    expect(outcomeCopy('timeout').label).toBe('Ditutup otomatis');
  });
});

describe('startModeLabel', () => {
  it('menerjemahkan mode ke bahasa yang bisa dipahami', () => {
    expect(startModeLabel('qr')).toBe('Mode QR');
    expect(startModeLabel('manual')).toBe('Pilih manual');
    expect(startModeLabel('gps_nearby')).toBe('Mode GPS');
  });

  it('tidak menampilkan string kosong untuk mode tak dikenal', () => {
    expect(startModeLabel('ajaib' as never)).toBe('Tidak diketahui');
  });
});

describe('presenceNote', () => {
  it('menjelaskan bahwa mode QR tidak memakai lokasi', () => {
    expect(presenceNote('qr_only')).toContain('Lokasi tidak dipakai');
  });

  it('jujur bahwa catatan tanpa verifikasi berbobot lebih rendah', () => {
    expect(presenceNote('unverified')).toContain('bobot lebih rendah');
  });

  it('memberi catatan untuk setiap tingkat kehadiran', () => {
    for (const presence of ['unverified', 'qr_only', 'qr_geo', 'gps_verified', 'field_verified'] as const) {
      expect(presenceNote(presence)).not.toBeNull();
    }
  });
});

describe('elapsedSeedMs', () => {
  it('memakai waktu server sebagai acuan, bukan jam perangkat', () => {
    expect(elapsedSeedMs('2026-10-26T03:42:00.000Z', '2026-10-26T03:43:05.000Z')).toBe(65_000);
  });

  it('tidak menghasilkan angka negatif saat jam server mundur', () => {
    expect(elapsedSeedMs('2026-10-26T03:42:00.000Z', '2026-10-26T03:40:00.000Z')).toBe(0);
  });

  it('mengembalikan null untuk tanggal rusak', () => {
    expect(elapsedSeedMs('bukan tanggal', null)).toBeNull();
    expect(elapsedSeedMs('2026-10-26T03:42:00.000Z', 'rusak')).toBeNull();
  });
});

describe('isClosedBySystem', () => {
  it('hanya menandai timeout sebagai penutupan otomatis', () => {
    expect(isClosedBySystem('timeout')).toBe(true);
    expect(isClosedBySystem('boarded')).toBe(false);
    expect(isClosedBySystem(null)).toBe(false);
  });
});

describe('ticketFromEpisode', () => {
  it('mengambil hanya fakta yang dikirim server', () => {
    const view = ticketFromEpisode(EPISODE, 'K3A');
    expect(view).toEqual({
      code: 'BMS-A12',
      name: 'Halte UMP',
      routeCode: 'K3A',
      modeLabel: 'Mode QR',
      startedAt: '2026-10-26T03:42:00.000Z',
      presenceNote: 'Halte dipastikan lewat QR. Lokasi tidak dipakai.',
      source: 'server',
    });
  });

  it('membiarkan kode koridor kosong bila tidak diketahui', () => {
    expect(ticketFromEpisode(EPISODE, null).routeCode).toBeNull();
  });
});
