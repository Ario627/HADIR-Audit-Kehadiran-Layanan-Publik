import {
  PASSWORD_PARAMS,
  burnPasswordTime,
  hashPassword,
  needsRehash,
  passwordWithinLimits,
  verifyPassword,
} from './password';

const FAST = { memoryCost: 4_096, timeCost: 1, parallelism: 1 };

describe('hashPassword', () => {
  it('produces an argon2id PHC string with the configured parameters', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', FAST);

    expect(stored.startsWith('$argon2id$v=19$')).toBe(true);
    expect(stored).toContain('m=4096');
    expect(stored).toContain('t=1');
    expect(stored).toContain('p=1');
  });

  it('never stores the plaintext', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', FAST);

    expect(stored).not.toContain('kata-sandi-panjang-1');
  });

  it('salts every hash so identical passwords differ', async () => {
    const left = await hashPassword('kata-sandi-panjang-1', FAST);
    const right = await hashPassword('kata-sandi-panjang-1', FAST);

    expect(left).not.toBe(right);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', FAST);

    await expect(verifyPassword(stored, 'kata-sandi-panjang-1', FAST)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', FAST);

    await expect(verifyPassword(stored, 'kata-sandi-panjang-2', FAST)).resolves.toBe(false);
  });

  it('rejects case and whitespace variants', async () => {
    const stored = await hashPassword('Kata-Sandi-Panjang', FAST);

    await expect(verifyPassword(stored, 'kata-sandi-panjang', FAST)).resolves.toBe(false);
    await expect(verifyPassword(stored, 'Kata-Sandi-Panjang ', FAST)).resolves.toBe(false);
  });

  it('returns false instead of throwing on a corrupt hash', async () => {
    await expect(verifyPassword('bukan-hash-argon2', 'apa saja', FAST)).resolves.toBe(false);
    await expect(verifyPassword('', 'apa saja', FAST)).resolves.toBe(false);
  });
});

describe('burnPasswordTime', () => {
  it('resolves without throwing so unknown users cost the same time', async () => {
    await expect(burnPasswordTime('apa-saja-panjang', FAST)).resolves.toBeUndefined();
  });
});

describe('needsRehash', () => {
  it('accepts a hash that already matches the current parameters', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', FAST);

    expect(needsRehash(stored, FAST)).toBe(false);
  });

  it('flags a hash built with weaker parameters', async () => {
    const stored = await hashPassword('kata-sandi-panjang-1', {
      memoryCost: 1_024,
      timeCost: 1,
      parallelism: 1,
    });

    expect(needsRehash(stored, PASSWORD_PARAMS)).toBe(true);
  });

  it('flags a non-argon2id hash', () => {
    expect(needsRehash('$argon2i$v=19$m=4096,t=1,p=1$abc$def', FAST)).toBe(true);
    expect(needsRehash('plain-text', FAST)).toBe(true);
  });
});

describe('passwordWithinLimits', () => {
  it('rejects values shorter than 12 bytes', () => {
    expect(passwordWithinLimits('pendek')).toBe(false);
    expect(passwordWithinLimits('12345678901')).toBe(false);
    expect(passwordWithinLimits('123456789012')).toBe(true);
  });

  it('counts bytes, not characters', () => {
    expect(passwordWithinLimits('日本語日本語日本')).toBe(true);
  });
});
