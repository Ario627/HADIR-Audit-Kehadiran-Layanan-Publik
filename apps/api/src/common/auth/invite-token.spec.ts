import { signInvite, verifyInvite, type InvitePayload } from './invite-token';

const SECRET = 'x'.repeat(48);
const NOW = new Date('2026-10-27T12:00:00.000Z');

const PAYLOAD: InvitePayload = {
  sub: '0192f0c4-0000-7000-8000-000000000001',
  inst: '0192f0c4-0000-7000-8000-000000000002',
  role: 'responder',
  jti: 'jti-0192f0c4-0000-7000',
  exp: Math.floor(NOW.getTime() / 1000) + 900,
};

describe('invite tokens', () => {
  it('round-trips a valid invite', () => {
    const decoded = verifyInvite(signInvite(PAYLOAD, SECRET), SECRET, NOW);

    expect(decoded?.payload).toEqual(PAYLOAD);
  });

  it('rejects a token signed with another secret', () => {
    expect(verifyInvite(signInvite(PAYLOAD, 'y'.repeat(48)), SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signInvite(PAYLOAD, SECRET);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...PAYLOAD, role: 'admin' }),
      'utf8',
    ).toString('base64url');

    expect(verifyInvite(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it('rejects an expired invite', () => {
    const later = new Date((PAYLOAD.exp + 1) * 1000);

    expect(verifyInvite(signInvite(PAYLOAD, SECRET), SECRET, later)).toBeNull();
  });

  it('rejects a malformed token', () => {
    for (const bad of ['', 'nodot', '.onlysig', 'onlybody.', 'a.b.c']) {
      expect(verifyInvite(bad, SECRET, NOW)).toBeNull();
    }
  });

  it('rejects a token whose body is not valid json', () => {
    const token = signInvite(PAYLOAD, SECRET);
    const signature = token.split('.')[1] ?? '';
    const garbage = Buffer.from('not json', 'utf8').toString('base64url');

    expect(verifyInvite(`${garbage}.${signature}`, SECRET, NOW)).toBeNull();
  });
});
