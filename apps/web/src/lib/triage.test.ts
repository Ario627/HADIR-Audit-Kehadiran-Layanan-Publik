import { describe, expect, it } from 'vitest';
import type { TriageAction, TriageResult } from '@hadir/contracts';
import {
  connectorNote,
  evidenceCount,
  intentOf,
  isServiceCategory,
  joinTarget,
  planActions,
  tierLabel,
  unsupportedLabels,
  verdictLabel,
} from './triage';

function action(kind: TriageAction['kind'], label: string): TriageAction {
  return { kind, label };
}

function resultOf(actions: TriageAction[]): TriageResult {
  return {
    sessionId: '018bcfe5-0000-7000-8000-0000000000aa',
    verdict: 'join',
    headline: 'Laporan serupa sudah ada',
    body: 'Dukungan dicatat sebagai bukti tambahan.',
    actions,
    evidence: [],
    connectors: {},
    rulesVersion: 'triage-v1',
    latencyMs: 120,
    reasons: [],
    requiresConfirmation: true,
  };
}

describe('intentOf', () => {
  it('memetakan aksi yang bisa dijalankan aplikasi', () => {
    expect(intentOf('send_anyway')).toBe('send');
    expect(intentOf('measure')).toBe('measure');
    expect(intentOf('open_radar')).toBe('corridor');
  });

  it('menandai aksi yang belum punya endpoint', () => {
    expect(intentOf('monitor')).toBe('unsupported');
    expect(intentOf('send_elsewhere')).toBe('unsupported');
  });

  it('mengenali aksi gabung sebagai aksi nyata', () => {
    expect(intentOf('join')).toBe('join');
  });
});

describe('planActions', () => {
  it('tetap menyertakan aksi kirim meski yang lain tidak didukung', () => {
    const planned = planActions(
      [action('monitor', 'Pantau'), action('send_elsewhere', 'Kirim ke instansi lain'), action('send_anyway', 'Tetap kirim')],
      { hasRoute: false, joinTarget: null },
    );
    expect(planned.map((entry) => entry.intent)).toEqual(['unsupported', 'unsupported', 'send']);
    expect(unsupportedLabels(planned)).toEqual(['Pantau', 'Kirim ke instansi lain']);
  });

  it('membuang aksi koridor saat routeId tidak diketahui', () => {
    const actions = [action('open_radar', 'Lihat radar'), action('send_anyway', 'Tetap kirim')];
    expect(planActions(actions, { hasRoute: false, joinTarget: null })).toHaveLength(1);
    expect(planActions(actions, { hasRoute: true, joinTarget: null })).toHaveLength(2);
  });

  it('mengaktifkan gabung hanya saat server memberi laporan target', () => {
    const actions = [action('join', 'Gabung ke laporan yang ada'), action('send_anyway', 'Tetap kirim')];
    const without = planActions(actions, { hasRoute: false, joinTarget: null });
    expect(without[0]?.intent).toBe('unsupported');

    const withTarget = planActions(actions, { hasRoute: false, joinTarget: '123456' });
    expect(withTarget[0]?.intent).toBe('join');
    expect(unsupportedLabels(withTarget)).toEqual([]);
  });

  it('tidak mengarang aksi saat server hanya mengirim satu', () => {
    const planned = planActions([action('send_anyway', 'Tetap kirim')], {
      hasRoute: true,
      joinTarget: null,
    });
    expect(planned).toEqual([{ kind: 'send_anyway', label: 'Tetap kirim', intent: 'send' }]);
  });
});

describe('connectorNote', () => {
  it('memperingatkan saat sebagian pemeriksaan tidak tersedia', () => {
    expect(connectorNote({ rup: 'unavailable', spm: 'ok' })).toContain('belum lengkap');
  });

  it('menjelaskan saat belum ada konektor terpasang', () => {
    expect(connectorNote({ rup: 'not_configured' })).toContain('belum tersambung');
  });

  it('tidak berkomentar saat semua pemeriksaan normal', () => {
    expect(connectorNote({ rup: 'ok' })).toBeNull();
    expect(connectorNote({})).toBeNull();
  });
});

describe('label', () => {
  it('menerjemahkan tier sumber', () => {
    expect(tierLabel('T1')).toBe('Dokumen resmi');
    expect(tierLabel('T4')).toBe('Laporan warga');
  });

  it('memberi label putusan untuk setiap nilai kontrak', () => {
    for (const verdict of [
      'join',
      'already_planned',
      'wrong_authority',
      'service_not_running',
      'data_supports',
      'data_insufficient',
      'new_report',
    ] as const) {
      expect(verdictLabel(verdict).length).toBeGreaterThan(0);
    }
  });

  it('mengenali kategori layanan yang memakai estimasi', () => {
    expect(isServiceCategory('service_wait')).toBe(true);
    expect(isServiceCategory('stop_safety')).toBe(false);
  });

  it('menghitung bukti yang dikirim server', () => {
    expect(evidenceCount(resultOf([]))).toBe(0);
  });
});

describe('joinTarget', () => {
  const withTarget: TriageResult = {
    ...resultOf([action('join', 'Gabung ke laporan yang ada')]),
    evidence: [
      {
        id: 'evt-1',
        claim: 'Laporan serupa dalam 60 hari terakhir',
        tier: 'T4',
        sourceUrl: null,
        retrievedAt: '2026-10-01T00:00:00.000Z',
        matchScore: 0.9,
        label: 'mungkin terkait',
        targetPublicId: '123456',
      },
    ],
  };

  it('mengambil laporan target pertama', () => {
    expect(joinTarget(withTarget)).toBe('123456');
  });

  it('mengembalikan null saat tidak ada target', () => {
    expect(joinTarget(resultOf([]))).toBeNull();
    const withoutTarget: TriageResult = {
      ...withTarget,
      evidence: [{ ...withTarget.evidence[0]!, targetPublicId: null }],
    };
    expect(joinTarget(withoutTarget)).toBeNull();
  });
});
