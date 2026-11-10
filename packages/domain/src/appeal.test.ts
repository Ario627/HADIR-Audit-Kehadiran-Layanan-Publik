import { describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOWS,
  appealAdmissibility,
  appealBurdenOfProof,
  appealCaveats,
  appealGroundsLabel,
  appealOutcomeEffect,
  appealWindow,
  describeAppeal,
  type AppealGrounds,
} from './appeal';

const DECIDED = '2026-10-01T00:00:00.000Z';

function request(overrides: Partial<Parameters<typeof appealAdmissibility>[0]> = {}) {
  return {
    grounds: 'rejection' as AppealGrounds,
    reportStatus: 'rejected',
    decidedAt: DECIDED,
    submittedAt: DECIDED,
    now: '2026-10-05T00:00:00.000Z',
    priorAppeals: 0,
    ...overrides,
  };
}

describe('appealGroundsLabel', () => {
  it('labels every ground in Indonesian', () => {
    expect(appealGroundsLabel('rejection')).toContain('Penolakan');
    expect(appealGroundsLabel('resolution')).toContain('penyelesaian');
    expect(appealGroundsLabel('moderation')).toContain('Moderasi');
    expect(appealGroundsLabel('service')).toContain('tindak lanjut');
  });
});

describe('appealWindow', () => {
  it('opens inside the window', () => {
    const window = appealWindow('rejection', DECIDED, '2026-10-05T00:00:00.000Z');
    expect(window.open).toBe(true);
    expect(window.days).toBe(APPEAL_WINDOWS.rejection);
    expect(window.reason).toBeNull();
  });

  it('closes after the window', () => {
    const window = appealWindow('rejection', DECIDED, '2026-11-01T00:00:00.000Z');
    expect(window.open).toBe(false);
    expect(window.reason).toContain('terlewat');
  });

  it('treats the deadline instant as still open', () => {
    const window = appealWindow('moderation', DECIDED, '2026-10-08T00:00:00.000Z');
    expect(window.open).toBe(true);
    expect(window.deadline).toBe('2026-10-08T00:00:00.000Z');
  });

  it('refuses to open without a decision', () => {
    const window = appealWindow('service', null, '2026-10-05T00:00:00.000Z');
    expect(window.open).toBe(false);
    expect(window.reason).toContain('Belum ada keputusan');
  });

  it('refuses an invalid deciding time', () => {
    const window = appealWindow('rejection', 'not-a-date', '2026-10-05T00:00:00.000Z');
    expect(window.open).toBe(false);
    expect(window.reason).toContain('tidak valid');
  });

  it('gives service grounds the widest window', () => {
    expect(APPEAL_WINDOWS.service).toBeGreaterThan(APPEAL_WINDOWS.rejection);
    expect(APPEAL_WINDOWS.moderation).toBeLessThan(APPEAL_WINDOWS.rejection);
  });
});

describe('appealAdmissibility', () => {
  it('accepts a fresh appeal inside the window', () => {
    const result = appealAdmissibility(request());
    expect(result.admissible).toBe(true);
    expect(result.refusal).toBeNull();
  });

  it('refuses an appeal before any decision exists', () => {
    const result = appealAdmissibility(request({ reportStatus: 'acknowledged' }));
    expect(result.admissible).toBe(false);
    expect(result.refusal).toBe('not_decided');
    expect(result.message).toContain('acknowledged');
  });

  it('accepts an appeal on a disputed case', () => {
    const result = appealAdmissibility(
      request({ reportStatus: 'disputed', grounds: 'resolution' }),
    );
    expect(result.admissible).toBe(true);
  });

  it('accepts an appeal on a verified case', () => {
    const result = appealAdmissibility(
      request({ reportStatus: 'verified_resolved', grounds: 'resolution' }),
    );
    expect(result.admissible).toBe(true);
  });

  it('refuses after two appeals', () => {
    const result = appealAdmissibility(request({ priorAppeals: 2 }));
    expect(result.refusal).toBe('appeal_limit');
  });

  it('refuses a repeated rejection appeal', () => {
    const result = appealAdmissibility(request({ priorAppeals: 1 }));
    expect(result.refusal).toBe('repeat_grounds');
  });

  it('allows a second appeal on a different ground', () => {
    const result = appealAdmissibility(
      request({
        priorAppeals: 1,
        grounds: 'resolution',
        reportStatus: 'verified_resolved',
      }),
    );
    expect(result.admissible).toBe(true);
  });

  it('refuses an appeal past the window', () => {
    const result = appealAdmissibility(request({ now: '2026-12-01T00:00:00.000Z' }));
    expect(result.refusal).toBe('window_closed');
  });
});

describe('appealOutcomeEffect', () => {
  it('keeps the status unchanged while undecided', () => {
    const effect = appealOutcomeEffect('rejection', null, 'rejected');
    expect(effect.toStatus).toBe('rejected');
    expect(effect.description).toContain('belum diputuskan');
  });

  it('keeps the status when the appeal is upheld', () => {
    const effect = appealOutcomeEffect('rejection', 'upheld', 'rejected');
    expect(effect.toStatus).toBe('rejected');
    expect(effect.description).toContain('dipertahankan');
  });

  it('reopens a rejected report when the appeal succeeds', () => {
    const effect = appealOutcomeEffect('rejection', 'overturned', 'rejected');
    expect(effect.fromStatus).toBe('rejected');
    expect(effect.toStatus).toBe('submitted');
  });

  it('reopens a verified case as disputed when the resolution appeal succeeds', () => {
    const effect = appealOutcomeEffect('resolution', 'overturned', 'verified_resolved');
    expect(effect.toStatus).toBe('disputed');
    expect(effect.description).toContain('dibatalkan');
  });

  it('returns a partially granted appeal to the queue', () => {
    const effect = appealOutcomeEffect('moderation', 'partial', 'rejected');
    expect(effect.toStatus).toBe('submitted');
    expect(effect.description).toContain('sebagian');
  });

  it('moves a service appeal back to acknowledged', () => {
    const effect = appealOutcomeEffect('service', 'overturned', 'submitted');
    expect(effect.toStatus).toBe('acknowledged');
  });
});

describe('appealBurdenOfProof', () => {
  it('assigns the burden to the appellant', () => {
    expect(appealBurdenOfProof('resolution')).toContain('masih terjadi');
    expect(appealBurdenOfProof('moderation')).toContain('tidak melanggar');
    expect(appealBurdenOfProof('service')).toContain('terlewat');
    expect(appealBurdenOfProof('rejection')).toContain('memenuhi syarat');
  });
});

describe('describeAppeal', () => {
  it('describes each stage', () => {
    expect(describeAppeal('rejection', 'submitted', null)).toContain('menunggu');
    expect(describeAppeal('rejection', 'inadmissible', null)).toContain('tidak dapat diterima');
    expect(describeAppeal('rejection', 'admitted', null)).toContain('sedang ditinjau');
    expect(describeAppeal('rejection', 'overturned', 'overturned')).toContain('dikabulkan');
    expect(describeAppeal('rejection', 'upheld', 'upheld')).toContain('ditolak');
    expect(describeAppeal('rejection', 'upheld', 'partial')).toContain('sebagian');
  });
});

describe('appealCaveats', () => {
  it('states that appeals never delete history', () => {
    const text = appealCaveats().join(' ');
    expect(text).toContain('tidak menghapus riwayat');
    expect(text).toContain('tidak otomatis berarti laporan benar');
    expect(text).toContain('Batas dua banding');
  });
});
