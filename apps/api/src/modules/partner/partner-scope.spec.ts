import type { PartnerSession } from '../../common/auth/partner-session';
import {
  PARTNER_ACTION_ROLE,
  assertPartnerCanAct,
  partnerCanAct,
} from './partner-scope';

function session(role: PartnerSession['role']): PartnerSession {
  return {
    sessionId: '0192f0c4-0000-7000-8000-0000000000f1',
    userId: '0192f0c4-0000-7000-8000-0000000000f2',
    displayName: 'Budi',
    institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
    institutionName: 'Dishub',
    role,
    createdAt: new Date('2026-10-27T11:00:00.000Z'),
    lastSeenAt: new Date('2026-10-27T11:59:00.000Z'),
    expiresAt: new Date('2026-11-03T11:00:00.000Z'),
    revokedAt: null,
  };
}

describe('partner action scope', () => {
  it('requires the responder role at minimum', () => {
    expect(PARTNER_ACTION_ROLE).toBe('responder');
  });

  it('lets a responder act', () => {
    expect(partnerCanAct(session('responder'))).toBe(true);
  });

  it('lets an admin act', () => {
    expect(partnerCanAct(session('admin'))).toBe(true);
  });

  it('keeps a viewer read-only', () => {
    expect(partnerCanAct(session('viewer'))).toBe(false);
  });

  it('throws FORBIDDEN for a viewer', () => {
    expect(() => assertPartnerCanAct(session('viewer'))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('passes silently for a responder', () => {
    expect(() => assertPartnerCanAct(session('responder'))).not.toThrow();
  });
});
