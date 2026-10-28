import { generateSecretKey, open, parseSecretKey, seal, SecretBoxError, sealedByteLength } from './secret-box';

const KEY = Buffer.alloc(32, 7);

describe('parseSecretKey', () => {
  it('accepts a 32-byte base64 key', () => {
    expect(parseSecretKey(generateSecretKey())).toHaveLength(32);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => parseSecretKey(Buffer.alloc(16, 1).toString('base64'))).toThrow(SecretBoxError);
    expect(() => parseSecretKey('')).toThrow(SecretBoxError);
  });
});

describe('seal and open', () => {
  it('round-trips a value', () => {
    const sealed = seal('warga@example.com', KEY);

    expect(open(sealed, KEY)).toBe('warga@example.com');
  });

  it('never puts the plaintext in the ciphertext', () => {
    const sealed = seal('warga@example.com', KEY);

    expect(sealed.toString('utf8')).not.toContain('warga');
    expect(sealed.toString('hex')).not.toContain(Buffer.from('warga').toString('hex'));
  });

  it('produces a different ciphertext for the same plaintext', () => {
    expect(seal('sama', KEY).equals(seal('sama', KEY))).toBe(false);
  });

  it('refuses to open with a different key', () => {
    const sealed = seal('rahasia', KEY);

    expect(() => open(sealed, Buffer.alloc(32, 8))).toThrow(SecretBoxError);
  });

  it('refuses a tampered ciphertext', () => {
    const sealed = seal('rahasia', KEY);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => open(tampered, KEY)).toThrow(SecretBoxError);
  });

  it('refuses a tampered authentication tag', () => {
    const sealed = seal('rahasia', KEY);
    const tampered = Buffer.from(sealed);
    tampered[15] ^= 0xff;

    expect(() => open(tampered, KEY)).toThrow(SecretBoxError);
  });

  it('refuses a truncated blob', () => {
    const sealed = seal('rahasia', KEY);

    expect(() => open(sealed.subarray(0, 10), KEY)).toThrow(SecretBoxError);
    expect(() => open(Buffer.alloc(0), KEY)).toThrow(SecretBoxError);
  });

  it('refuses an unknown version byte', () => {
    const sealed = seal('rahasia', KEY);
    const wrongVersion = Buffer.from(sealed);
    wrongVersion[0] = 9;

    expect(() => open(wrongVersion, KEY)).toThrow(SecretBoxError);
  });

  it('refuses empty plaintext', () => {
    expect(() => seal('', KEY)).toThrow(SecretBoxError);
  });

  it('refuses plaintext beyond the cap', () => {
    expect(() => seal('x'.repeat(2_000), KEY)).toThrow(SecretBoxError);
  });

  it('reports the exact sealed length', () => {
    const value = 'warga@example.com';

    expect(seal(value, KEY)).toHaveLength(sealedByteLength(Buffer.byteLength(value, 'utf8')));
  });
});
