import { b64urlToBuffer, bufferToB64url, isB64urlShape } from './webauthn-codec';

describe('webauthn codec', () => {
  it('round-trips a credential id', () => {
    const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);

    expect(b64urlToBuffer(bufferToB64url(raw)).equals(raw)).toBe(true);
  });

  it('produces url-safe output without padding characters', () => {
    const encoded = bufferToB64url(Buffer.from([251, 255, 190]));

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(isB64urlShape(encoded)).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(isB64urlShape('')).toBe(false);
  });
});
