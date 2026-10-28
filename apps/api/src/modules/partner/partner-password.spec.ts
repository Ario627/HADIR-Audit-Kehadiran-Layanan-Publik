import type { PartnerSession } from '../../common/auth/partner-session';
import type { Actor } from '../../common/http/request-context';
import type {
  OtpChallengeRow,
  PartnerCredentialRepository,
  PasswordCredentialRow,
} from '../../db/repositories/partner-credential.repository';
import { recordingAudit } from '../../test-support/audit.stub';
import { PartnerCredentialService } from './partner-credential.service';
import { hashPassword } from '../../common/auth/password';

const FAST = { memoryCost: 4_096, timeCost: 1, parallelism: 1 };

const SESSION: PartnerSession = {
  sessionId: '0192f0c4-0000-7000-8000-0000000000f1',
  userId: '0192f0c4-0000-7000-8000-0000000000f2',
  displayName: 'Budi',
  institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
  institutionName: 'Dishub',
  role: 'responder',
  createdAt: new Date('2026-10-27T11:00:00.000Z'),
  lastSeenAt: new Date('2026-10-27T11:59:00.000Z'),
  expiresAt: new Date('2026-11-03T11:00:00.000Z'),
  revokedAt: null,
};

interface Store {
  password: string | null;
  failures: number;
  cleared: number;
  writes: string[];
}

function repositoryDouble(store: Store): PartnerCredentialRepository {
  return {
    findPasswordByUserId: async (): Promise<PasswordCredentialRow | null> =>
      store.password === null ? null : { userId: SESSION.userId, passwordHash: store.password },
    upsertPassword: async (_userId: string, hash: string) => {
      store.password = hash;
      store.writes.push(hash);
    },
    clearFailures: async () => {
      store.cleared += 1;
    },
    readLockState: async () => ({ failedLoginCount: store.failures, lockedUntil: null }),
    recordFailure: async (_id: string, count: number) => {
      store.failures = count;
    },
    findLatestOpenOtp: async (): Promise<OtpChallengeRow | null> => null,
  } as unknown as PartnerCredentialRepository;
}

function newStore(password: string | null): Store {
  return { password, failures: 0, cleared: 0, writes: [] };
}

async function build(password: string | null) {
  const store = newStore(password);
  const audit = recordingAudit();
  const service = new PartnerCredentialService(repositoryDouble(store), audit.service);
  return { service, store, audit };
}

const CONTEXT = { requestId: 'req-1', ipHash: 'f'.repeat(64) };

describe('changePassword', () => {
  it('rejects a wrong current password', async () => {
    const { service, store } = await build(await hashPassword('kata-sandi-lama-1', FAST));

    await expect(
      service.changePassword({
        session: SESSION,
        currentPassword: 'kata-sandi-salah',
        newPassword: 'kata-sandi-baru-22',
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(store.writes).toHaveLength(0);
  });

  it('records the failed attempt without leaking which part was wrong', async () => {
    const { service, audit } = await build(await hashPassword('kata-sandi-lama-1', FAST));

    await expect(
      service.changePassword({
        session: SESSION,
        currentPassword: 'salah',
        newPassword: 'kata-sandi-baru-22',
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({ detail: 'Kata sandi saat ini tidak cocok.' });

    expect(audit.records[0]).toMatchObject({
      action: 'partner.login_failed',
      payload: { reason: 'password_change_wrong_current' },
    });
  });

  it('rejects a weak new password even when the current one is right', async () => {
    const { service, store } = await build(await hashPassword('kata-sandi-lama-1', FAST));

    await expect(
      service.changePassword({
        session: SESSION,
        currentPassword: 'kata-sandi-lama-1',
        newPassword: 'pendek',
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.writes).toHaveLength(0);
  });

  it('reports every policy breach at once', async () => {
    const { service } = await build(await hashPassword('kata-sandi-lama-1', FAST));

    await expect(
      service.changePassword({
        session: SESSION,
        currentPassword: 'kata-sandi-lama-1',
        newPassword: 'aaa',
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'newPassword', code: 'too_short' }),
      ]),
    });
  });

  it('stores a fresh hash and clears the failure counter', async () => {
    const { service, store } = await build(await hashPassword('kata-sandi-lama-1', FAST));
    store.failures = 4;

    await service.changePassword({
      session: SESSION,
      currentPassword: 'kata-sandi-lama-1',
      newPassword: 'kata-sandi-baru-22',
      ...CONTEXT,
    });

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.startsWith('$argon2id$')).toBe(true);
    expect(store.writes[0]).not.toContain('kata-sandi-baru-22');
    expect(store.cleared).toBe(1);
    expect(store.failures).toBe(4);
  });

  it('writes the real institution into the audit trail', async () => {
    const { service, audit } = await build(await hashPassword('kata-sandi-lama-1', FAST));

    await service.changePassword({
      session: SESSION,
      currentPassword: 'kata-sandi-lama-1',
      newPassword: 'kata-sandi-baru-22',
      ...CONTEXT,
    });

    expect(audit.records[0]).toMatchObject({
      action: 'partner.password_changed',
      objectId: SESSION.userId,
      actor: {
        kind: 'partner',
        userId: SESSION.userId,
        institutionId: SESSION.institutionId,
        role: 'responder',
      } as Actor,
    });
  });

  it('refuses when the account has no password yet', async () => {
    const { service } = await build(null);

    await expect(
      service.changePassword({
        session: SESSION,
        currentPassword: 'apa-saja-panjang',
        newPassword: 'kata-sandi-baru-22',
        ...CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
