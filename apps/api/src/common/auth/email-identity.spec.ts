import { hashEmail, normalizeEmail } from './email-identity';

const SECRET = 's'.repeat(48);

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Budi@Dishub.GO.ID  ')).toBe('budi@dishub.go.id');
  });

  it('is idempotent so registration and login hash the same value', () => {
    const once = normalizeEmail('Budi@Dishub.go.id');

    expect(normalizeEmail(once ?? '')).toBe(once);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'bukan-email', '@domain.id', 'a@', 'a@b', 'a@@b.id']) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('rejects anything over 254 characters', () => {
    expect(normalizeEmail(`${'a'.repeat(250)}@b.id`)).toBeNull();
  });

  it('accepts plus addressing and subdomains', () => {
    expect(normalizeEmail('budi+hadir@mail.dishub.go.id')).toBe('budi+hadir@mail.dishub.go.id');
  });
});

describe('hashEmail', () => {
  it('returns 64 hex characters', () => {
    expect(hashEmail('budi@dishub.go.id', SECRET)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashEmail('budi@dishub.go.id', SECRET)).toBe(hashEmail('budi@dishub.go.id', SECRET));
  });

  it('never reveals the address', () => {
    expect(hashEmail('budi@dishub.go.id', SECRET)).not.toContain('budi');
  });

  it('changes with the secret so a stolen dump cannot be enumerated', () => {
    expect(hashEmail('budi@dishub.go.id', SECRET)).not.toBe(
      hashEmail('budi@dishub.go.id', 't'.repeat(48)),
    );
  });

  it('gives different hashes for different addresses', () => {
    expect(hashEmail('a@b.id', SECRET)).not.toBe(hashEmail('c@b.id', SECRET));
  });
});
