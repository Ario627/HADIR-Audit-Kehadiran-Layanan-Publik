import { hashPassword } from '../../common/auth/password';
import { hotp } from '../../common/auth/totp';
import { recordingAudit } from '../../test-support/audit.stub';
import type { PlatformAdminRepository } from '../../db/repositories/platform-admin.repository';
import { PlatformAuthService, sealTotpSecret } from './platform-auth.service';

const ADMIN_ID = '0192f0c4-0000-7000-8000-0000000000d1';
const PASSWORD = 'kata-sandi-panjang-sekali';
const TOTP_SECRET = Buffer.from('12345678901234567890', 'utf8');

interface Attempt {
  email: string;
  password: string;
  totp: string;
  requestId: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    email: 'ops@hadir.id',
    password: PASSWORD,
    totp: '000000',
    requestId: 'req-admin-1',
    ipHash: null,
    userAgentHash: null,
    ...overrides,
  };
}

async function buildAdmin(overrides: Record<string, unknown> = {}) {
  const passwordHash = await hashPassword(PASSWORD);
  return {
    adminId: ADMIN_ID,
    email: 'ops@hadir.id',
    displayName: 'Operator',
    role: 'superadmin' as const,
    passwordHash,
    totpSecretEnc: sealTotpSecret(TOTP_SECRET),
    totpEnrolledAt: new Date('2026-10-01T00:00:00.000Z'),
    lastTotpStep: null as number | null,
    disabledAt: null as Date | null,
    ...overrides,
  };
}

function buildService(
  admin: Awaited<ReturnType<typeof buildAdmin>> | null,
  behaviour: { recordTotpStep?: (step: number) => Promise<boolean> } = {},
) {
  const audit = recordingAudit();
  const calls: { sessions: unknown[] } = { sessions: [] };
  const repository = {
    findAdminByEmail: async () => admin,
    latestTotpStep: async () => admin?.lastTotpStep ?? null,
    recordTotpStep: async (_adminId: string, step: number) =>
      behaviour.recordTotpStep === undefined
        ? true
        : behaviour.recordTotpStep(step),
    createSession: async (input: unknown) => {
      calls.sessions.push(input);
      return '0192f0c4-0000-7000-8000-0000000000f1';
    },
    touchSession: async () => undefined,
    revokeSession: async () => undefined,
    findSessionByTokenHash: async () => null,
  } as unknown as PlatformAdminRepository;
  return { service: new PlatformAuthService(repository, audit.service), audit, calls };
}

function currentCode(): string {
  return hotp(TOTP_SECRET, Math.floor(Date.now() / 1000 / 30));
}

describe('PlatformAuthService.login', () => {
  it('rejects an unknown admin and still burns password time', async () => {
    const { service, audit } = buildService(null);
    await expect(service.login(attempt())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(audit.records[0]).toMatchObject({
      action: 'admin.login_failed',
      payload: { reason: 'unknown_admin' },
    });
  });

  it('rejects a disabled admin', async () => {
    const admin = await buildAdmin({ disabledAt: new Date('2026-10-02T00:00:00.000Z') });
    const { service, audit } = buildService(admin);
    await expect(service.login(attempt())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(audit.records[0]).toMatchObject({ payload: { reason: 'disabled' } });
  });

  it('rejects a wrong password before touching TOTP', async () => {
    const admin = await buildAdmin();
    const { service, audit } = buildService(admin);
    await expect(
      service.login(attempt({ password: 'kata-sandi-yang-salah-sekali' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(audit.records[0]).toMatchObject({ payload: { reason: 'password' } });
  });

  it('rejects a wrong TOTP code even with the right password', async () => {
    const admin = await buildAdmin();
    const { service, audit } = buildService(admin);
    await expect(
      service.login(attempt({ totp: '000000' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(audit.records[0]).toMatchObject({ payload: { reason: 'mismatch' } });
  });

  it('refuses a replayed TOTP step', async () => {
    const step = Math.floor(Date.now() / 1000 / 30);
    const admin = await buildAdmin({ lastTotpStep: step });
    const { service, audit } = buildService(admin);
    await expect(
      service.login(attempt({ totp: hotp(TOTP_SECRET, step) })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(audit.records[0]).toMatchObject({ payload: { reason: 'replay' } });
  });

  it('refuses when the step claim loses a race', async () => {
    const admin = await buildAdmin();
    const { service } = buildService(admin, { recordTotpStep: async () => false });
    await expect(
      service.login(attempt({ totp: currentCode() })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('issues a session and audits a successful login', async () => {
    const admin = await buildAdmin();
    const { service, audit, calls } = buildService(admin);
    const issued = await service.login(attempt({ totp: currentCode() }));

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.session.role).toBe('superadmin');
    expect(calls.sessions).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({ action: 'admin.login' });
  });

  it('never returns the password hash or the TOTP secret', async () => {
    const admin = await buildAdmin();
    const { service } = buildService(admin);
    const issued = await service.login(attempt({ totp: currentCode() }));
    const serialised = JSON.stringify(issued.session);
    expect(serialised).not.toContain('totp');
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain(admin.passwordHash);
  });
});

describe('PlatformAuthService.resolve', () => {
  it('ignores malformed tokens without hitting the database', async () => {
    const { service } = buildService(null);
    expect(await service.resolve('short')).toBeNull();
    expect(await service.resolve(null)).toBeNull();
  });

  it('returns null when the repository finds no live session', async () => {
    const { service } = buildService(null);
    expect(await service.resolve('a'.repeat(43))).toBeNull();
  });
});

describe('PlatformAuthService.logout', () => {
  it('revokes the session and audits it', async () => {
    const admin = await buildAdmin();
    const { service, audit } = buildService(admin);
    const issued = await service.login(attempt({ totp: currentCode() }));
    audit.records.length = 0;

    await service.logout(issued.session, 'req-admin-2');

    expect(audit.records[0]).toMatchObject({ action: 'admin.logout' });
  });
});
