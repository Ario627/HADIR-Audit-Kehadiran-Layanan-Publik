import { describe, expect, it } from 'vitest';
import type { PartnerAction } from '@hadir/contracts';
import {
  INBOX_STATUSES,
  PARTNER_ACTIONS,
  abilitiesFor,
  actionIssueText,
  actionSpec,
  buildActionInput,
  bucketCountText,
  followUpText,
  hasPasswordIssue,
  hoursText,
  isInboxStatus,
  isOpenStatus,
  isReportCategory,
  issuesForAction,
  minScheduleValue,
  partnerTargetFor,
  passkeyDeviceLabel,
  passkeyUsedText,
  ratioText,
  readInboxFilter,
  readPasswordIssues,
  roleLabel,
  sessionAgeText,
  toInboxSearch,
  type ActionIssue,
  type ActionValues,
} from './partner';

const NOW = Date.parse('2026-10-28T09:00:00.000Z');
const EMPTY: ActionValues = { note: '', reason: '', scheduledFor: '' };

describe('actionSpec', () => {
  it('describes every partner action', () => {
    for (const action of PARTNER_ACTIONS) {
      const spec = actionSpec(action);
      expect(spec.action).toBe(action);
      expect(spec.label.length).toBeGreaterThan(3);
      expect(spec.confirm.length).toBeGreaterThan(10);
    }
  });

  it('requires a ten character note only for claim_resolved', () => {
    const demanding = PARTNER_ACTIONS.filter((action) => actionSpec(action).noteMin > 0);
    expect(demanding).toEqual(['claim_resolved']);
    expect(actionSpec('claim_resolved').noteMin).toBe(10);
  });

  it('marks the destructive action as danger', () => {
    expect(actionSpec('reject_with_reason').tone).toBe('danger');
    expect(actionSpec('reject_with_reason').reasonRequired).toBe(true);
  });

  it('marks schedule as the only scheduling action', () => {
    const scheduling = PARTNER_ACTIONS.filter((action) => actionSpec(action).scheduleRequired);
    expect(scheduling).toEqual(['schedule']);
  });

  it('hides the note field for rejections', () => {
    expect(actionSpec('reject_with_reason').noteLabel).toBeNull();
  });
});

describe('issuesForAction', () => {
  const reject = (values: Partial<ActionValues>): readonly ActionIssue[] =>
    issuesForAction('reject_with_reason', { ...EMPTY, ...values }, NOW);

  it('blocks a rejection without a reason', () => {
    expect(reject({})).toEqual(['reason_required']);
    expect(reject({ reason: '   ' })).toEqual(['reason_required']);
  });

  it('accepts a rejection with a reason', () => {
    expect(reject({ reason: 'Bukan wilayah layanan instansi ini.' })).toEqual([]);
  });

  it('blocks a claim without evidence text', () => {
    expect(issuesForAction('claim_resolved', EMPTY, NOW)).toEqual(['note_required']);
  });

  it('blocks a claim with too short evidence', () => {
    expect(issuesForAction('claim_resolved', { ...EMPTY, note: 'sudah' }, NOW)).toEqual([
      'note_too_short',
    ]);
  });

  it('accepts a claim at the minimum length', () => {
    expect(issuesForAction('claim_resolved', { ...EMPTY, note: '0123456789' }, NOW)).toEqual([]);
  });

  it('lets acknowledge and respond through without a note', () => {
    expect(issuesForAction('acknowledge', EMPTY, NOW)).toEqual([]);
    expect(issuesForAction('respond', EMPTY, NOW)).toEqual([]);
  });

  it('requires a schedule time', () => {
    expect(issuesForAction('schedule', EMPTY, NOW)).toEqual(['schedule_required']);
  });

  it('rejects a schedule in the past', () => {
    expect(
      issuesForAction('schedule', { ...EMPTY, scheduledFor: '2026-10-01T08:00' }, NOW),
    ).toEqual(['schedule_in_past']);
  });

  it('tolerates a schedule within the clock skew window', () => {
    const nearlyNow = minScheduleValue(NOW - 30_000);
    expect(issuesForAction('schedule', { ...EMPTY, scheduledFor: nearlyNow }, NOW)).toEqual([]);
  });

  it('accepts a future schedule', () => {
    expect(
      issuesForAction('schedule', { ...EMPTY, scheduledFor: '2026-11-02T09:00' }, NOW),
    ).toEqual([]);
  });

  it('reports an unparseable schedule', () => {
    expect(issuesForAction('schedule', { ...EMPTY, scheduledFor: 'besok' }, NOW)).toEqual([
      'schedule_in_past',
    ]);
  });
});

describe('actionIssueText', () => {
  it('has Indonesian copy for every issue', () => {
    const issues: readonly ActionIssue[] = [
      'note_required',
      'note_too_short',
      'reason_required',
      'schedule_required',
      'schedule_in_past',
    ];
    for (const issue of issues) {
      expect(actionIssueText(issue).length).toBeGreaterThan(10);
    }
  });
});

describe('buildActionInput', () => {
  it('omits an empty optional note', () => {
    expect(buildActionInput('acknowledge', { ...EMPTY, note: '   ' })).toEqual({
      action: 'acknowledge',
    });
  });

  it('trims the note before sending', () => {
    expect(buildActionInput('respond', { ...EMPTY, note: '  sudah dicek  ' })).toEqual({
      action: 'respond',
      note: 'sudah dicek',
    });
  });

  it('never sends a note for a rejection', () => {
    expect(
      buildActionInput('reject_with_reason', { ...EMPTY, note: 'abaikan', reason: 'duplikat' }),
    ).toEqual({ action: 'reject_with_reason', reason: 'duplikat' });
  });

  it('converts a local schedule into an offset timestamp', () => {
    const input = buildActionInput('schedule', { ...EMPTY, scheduledFor: '2026-11-02T09:00' });
    expect(input.scheduledFor).toBe(new Date('2026-11-02T09:00').toISOString());
    expect(input.scheduledFor?.endsWith('Z')).toBe(true);
  });

  it('caps an overlong note at the contract limit', () => {
    const input = buildActionInput('respond', { ...EMPTY, note: 'a'.repeat(900) });
    expect(input.note).toHaveLength(500);
  });

  it('caps an overlong reason at the contract limit', () => {
    const input = buildActionInput('reject_with_reason', { ...EMPTY, reason: 'b'.repeat(400) });
    expect(input.reason).toHaveLength(200);
  });
});

describe('status helpers', () => {
  it('treats only unfinished statuses as open', () => {
    expect(isOpenStatus('submitted')).toBe(true);
    expect(isOpenStatus('in_progress')).toBe(true);
    expect(isOpenStatus('verified_resolved')).toBe(false);
    expect(isOpenStatus('rejected')).toBe(false);
  });

  it('accepts only inbox statuses from untrusted input', () => {
    expect(isInboxStatus('acknowledged')).toBe(true);
    expect(isInboxStatus('draft')).toBe(false);
    expect(isInboxStatus('semua')).toBe(false);
    expect(isInboxStatus(undefined)).toBe(false);
  });

  it('never offers draft in the inbox filter', () => {
    expect(INBOX_STATUSES).not.toContain('draft');
  });

  it('accepts only known categories', () => {
    expect(isReportCategory('service_wait')).toBe(true);
    expect(isReportCategory('bencana')).toBe(false);
  });
});

describe('readInboxFilter', () => {
  it('defaults to all', () => {
    expect(readInboxFilter({})).toEqual({ status: 'all', category: 'all' });
  });

  it('keeps valid values', () => {
    expect(readInboxFilter({ status: 'acknowledged', kategori: 'stop_safety' })).toEqual({
      status: 'acknowledged',
      category: 'stop_safety',
    });
  });

  it('drops invalid values instead of forwarding them', () => {
    expect(readInboxFilter({ status: 'draft', kategori: 'zzz' })).toEqual({
      status: 'all',
      category: 'all',
    });
  });
});

describe('toInboxSearch', () => {
  it('omits defaults', () => {
    expect(toInboxSearch({ status: 'all', category: 'all' })).toEqual({});
  });

  it('serialises non-default values', () => {
    expect(toInboxSearch({ status: 'submitted', category: 'service_wait' })).toEqual({
      status: 'submitted',
      kategori: 'service_wait',
    });
  });
});

describe('partnerTargetFor', () => {
  it('accepts the two partner landing paths', () => {
    expect(partnerTargetFor('/partner')).toBe('/partner');
    expect(partnerTargetFor('/partner/laporan')).toBe('/partner/laporan');
  });

  it('collapses a detail path into the inbox', () => {
    expect(partnerTargetFor('/partner/laporan/ABC123')).toBe('/partner/laporan');
  });

  it('refuses anything outside the partner area', () => {
    expect(partnerTargetFor('/admin')).toBeNull();
    expect(partnerTargetFor('https://evil.example/partner')).toBeNull();
    expect(partnerTargetFor('//evil.example/partner')).toBeNull();
    expect(partnerTargetFor('/partner/../../etc')).toBeNull();
    expect(partnerTargetFor('')).toBeNull();
    expect(partnerTargetFor(null)).toBeNull();
    expect(partnerTargetFor(42)).toBeNull();
  });

  it('refuses an overlong path', () => {
    expect(partnerTargetFor(`/partner/laporan/${'a'.repeat(300)}`)).toBeNull();
  });
});

describe('minScheduleValue', () => {
  it('renders a datetime-local value in local time', () => {
    expect(minScheduleValue(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('followUpText', () => {
  it('returns null without a schedule', () => {
    expect(followUpText(null, NOW)).toBeNull();
  });

  it('returns null for an unparseable schedule', () => {
    expect(followUpText('besok', NOW)).toBeNull();
  });

  it('describes an upcoming schedule', () => {
    expect(followUpText(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe('Jadwal 3 hari lagi');
    expect(followUpText(new Date(NOW + 86_400_000).toISOString(), NOW)).toBe('Jadwal besok');
  });

  it('describes an overdue schedule', () => {
    expect(followUpText(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe(
      'Lewat 2 hari dari jadwal',
    );
    expect(followUpText(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(
      'Lewat satu hari dari jadwal',
    );
  });
});

describe('ratioText', () => {
  it('formats a ratio as a percentage', () => {
    expect(ratioText(0)).toBe('0%');
    expect(ratioText(0.426)).toBe('43%');
    expect(ratioText(1)).toBe('100%');
  });

  it('clamps outside [0, 1]', () => {
    expect(ratioText(1.4)).toBe('100%');
    expect(ratioText(-2)).toBe('0%');
  });

  it('refuses to invent a number', () => {
    expect(ratioText(null)).toBe('belum ada data');
    expect(ratioText(Number.NaN)).toBe('belum ada data');
  });
});

describe('hoursText', () => {
  it('uses minutes below one hour', () => {
    expect(hoursText(0.5)).toBe('30 menit');
    expect(hoursText(0)).toBe('1 menit');
  });

  it('uses hours below two days', () => {
    expect(hoursText(5)).toBe('5 jam');
    expect(hoursText(2.34)).toBe('2.3 jam');
  });

  it('uses days beyond two days', () => {
    expect(hoursText(72)).toBe('3 hari');
  });

  it('refuses to invent a number', () => {
    expect(hoursText(null)).toBe('belum ada data');
    expect(hoursText(-1)).toBe('belum ada data');
  });
});

describe('bucketCountText', () => {
  it('shows the count when publishable', () => {
    expect(bucketCountText({ count: 7, suppressed: false })).toBe('7');
  });

  it('hides suppressed buckets', () => {
    expect(bucketCountText({ count: 3, suppressed: true })).toBe('disembunyikan');
    expect(bucketCountText({ count: null, suppressed: false })).toBe('disembunyikan');
  });
});

describe('action coverage', () => {
  it('covers exactly the six contract actions', () => {
    const expected: readonly PartnerAction[] = [
      'acknowledge',
      'request_info',
      'schedule',
      'respond',
      'claim_resolved',
      'reject_with_reason',
    ];
    expect([...PARTNER_ACTIONS].sort()).toEqual([...expected].sort());
  });
});

describe('abilitiesFor', () => {
  it('gives viewers read-only access', () => {
    const abilities = abilitiesFor('viewer');
    expect(abilities.act).toBe(false);
    expect(abilities.exportData).toBe(false);
    expect(abilities.removePasskey).toBe(false);
    expect(abilities.revokeSessions).toBe(false);
  });

  it('lets responders act and export', () => {
    const abilities = abilitiesFor('responder');
    expect(abilities.act).toBe(true);
    expect(abilities.exportData).toBe(true);
    expect(abilities.removePasskey).toBe(false);
    expect(abilities.revokeSessions).toBe(false);
  });

  it('lets admins manage credentials', () => {
    const abilities = abilitiesFor('admin');
    expect(abilities.removePasskey).toBe(true);
    expect(abilities.revokeSessions).toBe(true);
  });

  it('lets every role register its own passkey', () => {
    expect(abilitiesFor('viewer').registerPasskey).toBe(true);
    expect(abilitiesFor('responder').registerPasskey).toBe(true);
    expect(abilitiesFor('admin').registerPasskey).toBe(true);
  });
});

describe('roleLabel', () => {
  it('renders Indonesian role names', () => {
    expect(roleLabel('viewer')).toBe('Pembaca');
    expect(roleLabel('responder')).toBe('Penanggap');
    expect(roleLabel('admin')).toBe('Admin instansi');
  });
});

describe('sessionAgeText', () => {
  it('describes a brand new session', () => {
    expect(sessionAgeText(new Date(NOW).toISOString(), NOW)).toBe('Sesi baru dibuat');
  });

  it('counts minutes and hours', () => {
    expect(sessionAgeText(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe(
      'Sesi dibuat 12 menit lalu',
    );
    expect(sessionAgeText(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe(
      'Sesi dibuat 3 jam lalu',
    );
    expect(sessionAgeText(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe(
      'Sesi dibuat 2 hari lalu',
    );
  });

  it('refuses to invent an age', () => {
    expect(sessionAgeText('kemarin', NOW)).toBe('Umur sesi tidak diketahui');
    expect(sessionAgeText(new Date(NOW + 60_000).toISOString(), NOW)).toBe(
      'Umur sesi tidak diketahui',
    );
  });
});

describe('passkeyDeviceLabel', () => {
  it('names synced and single device keys', () => {
    expect(passkeyDeviceLabel('multiDevice')).toBe('Passkey tersinkron');
    expect(passkeyDeviceLabel('singleDevice')).toBe('Terikat perangkat ini');
    expect(passkeyDeviceLabel(null)).toBe('Jenis perangkat tidak dilaporkan');
  });
});

describe('passkeyUsedText', () => {
  it('describes recent use', () => {
    expect(passkeyUsedText(null, NOW)).toBe('Belum pernah dipakai');
    expect(passkeyUsedText(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe('Dipakai hari ini');
    expect(passkeyUsedText(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe('Dipakai kemarin');
    expect(passkeyUsedText(new Date(NOW - 5 * 86_400_000).toISOString(), NOW)).toBe(
      'Dipakai 5 hari lalu',
    );
  });

  it('refuses to invent a time', () => {
    expect(passkeyUsedText('kemarin', NOW)).toBe('Waktu pakai tidak diketahui');
    expect(passkeyUsedText(new Date(NOW + 60_000).toISOString(), NOW)).toBe(
      'Waktu pakai tidak diketahui',
    );
  });
});

describe('readPasswordIssues', () => {
  const valid = { current: 'lama-sekali-123', next: 'baru-sekali-456', confirm: 'baru-sekali-456' };

  it('accepts a valid change', () => {
    const issues = readPasswordIssues(valid);
    expect(hasPasswordIssue(issues)).toBe(false);
  });

  it('requires the current password', () => {
    expect(readPasswordIssues({ ...valid, current: '' }).current).not.toBeNull();
  });

  it('enforces the minimum length', () => {
    const issues = readPasswordIssues({ ...valid, next: 'pendek', confirm: 'pendek' });
    expect(issues.next).toContain('minimal 12 karakter');
  });

  it('refuses a new password equal to the old one', () => {
    const issues = readPasswordIssues({
      current: 'sama-sekali-123',
      next: 'sama-sekali-123',
      confirm: 'sama-sekali-123',
    });
    expect(issues.next).toContain('harus berbeda');
  });

  it('requires a matching confirmation', () => {
    expect(readPasswordIssues({ ...valid, confirm: 'beda-sekali-789' }).confirm).not.toBeNull();
  });

  it('reports every problem at once', () => {
    const issues = readPasswordIssues({ current: '', next: 'x', confirm: 'y' });
    expect(hasPasswordIssue(issues)).toBe(true);
    expect(issues.current).not.toBeNull();
    expect(issues.next).not.toBeNull();
    expect(issues.confirm).not.toBeNull();
  });
});
