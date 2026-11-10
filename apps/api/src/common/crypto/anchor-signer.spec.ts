import { createHash, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { ANCHOR_ALGORITHM, canonicalAnchorPayload, type AnchorEnvelope } from '@hadir/domain';
import {
  anchorSignedParts,
  createAnchorSigner,
  generateAnchorKeyPair,
  requireAnchorSigner,
  verifyAnchorSignature,
} from './anchor-signer';
import { AppError } from '../errors/app-error';

const KEY_ID = 'anchor-test-key';
const LOCAL = generateAnchorKeyPair();

function envelope(overrides: Partial<AnchorEnvelope> = {}): AnchorEnvelope {
  return {
    anchorDate: '2026-10-01',
    merkleRootBase64: Buffer.alloc(32, 7).toString('base64'),
    leafCount: 12,
    windowStart: '2026-10-01T00:00:00.000Z',
    windowEnd: '2026-10-02T00:00:00.000Z',
    signingKeyId: KEY_ID,
    signatureAlgorithm: ANCHOR_ALGORITHM,
    signatureBase64: null,
    publicKeyBase64: null,
    signedAt: null,
    ...overrides,
  };
}

describe('createAnchorSigner', () => {
  it('derives the raw 32 byte public key from the private key', () => {
    const signer = createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: KEY_ID });
    expect(signer.keyId).toBe(KEY_ID);
    expect(Buffer.from(signer.publicKeyBase64, 'base64')).toHaveLength(32);
    expect(signer.publicKeyBase64).toBe(LOCAL.publicKeyBase64);
  });

  it('produces 64 byte signatures', () => {
    const signer = createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: KEY_ID });
    expect(signer.sign('hello')).toHaveLength(64);
  });

  it('is deterministic for the same payload', () => {
    const signer = createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: KEY_ID });
    expect(signer.sign('hello').equals(signer.sign('hello'))).toBe(true);
  });

  it('rejects a key id that is empty or too long', () => {
    expect(() => createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: '  ' })).toThrow();
    expect(() =>
      createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: 'k'.repeat(65) }),
    ).toThrow();
  });

  it('rejects a key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(() => createAnchorSigner({ privateKey: pem, keyId: KEY_ID })).toThrow(/Ed25519/);
  });
});

describe('anchorSignedParts', () => {
  const signer = createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: KEY_ID });
  const signedAt = new Date('2026-10-02T00:05:00.000Z');

  it('signs the canonical payload and returns every envelope field', () => {
    const parts = anchorSignedParts(signer, envelope(), signedAt);
    expect(parts.canonicalPayload).toBe(canonicalAnchorPayload(envelope()));
    expect(parts.signatureAlgorithm).toBe('ed25519');
    expect(parts.signingKeyId).toBe(KEY_ID);
    expect(Buffer.from(parts.signatureBase64, 'base64')).toHaveLength(64);
    expect(parts.publicKeyBase64).toBe(LOCAL.publicKeyBase64);
    expect(parts.signedAt).toBe(signedAt);
  });

  it('produces a signature that verifies', () => {
    const parts = anchorSignedParts(signer, envelope(), signedAt);
    expect(
      verifyAnchorSignature({
        envelope: envelope(),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(true);
  });
});

describe('verifyAnchorSignature', () => {
  const signer = createAnchorSigner({ privateKey: LOCAL.privateKeyPem, keyId: KEY_ID });
  const parts = anchorSignedParts(signer, envelope(), new Date('2026-10-02T00:05:00.000Z'));

  it('rejects a tampered merkle root', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope({ merkleRootBase64: Buffer.alloc(32, 8).toString('base64') }),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('rejects a tampered leaf count', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope({ leafCount: 13 }),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('rejects a tampered date', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope({ anchorDate: '2026-10-02' }),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('rejects a signature from another key', () => {
    const other = generateAnchorKeyPair();
    const otherSigner = createAnchorSigner({ privateKey: other.privateKeyPem, keyId: 'other' });
    const otherParts = anchorSignedParts(
      otherSigner,
      envelope({ signingKeyId: 'other' }),
      new Date('2026-10-02T00:05:00.000Z'),
    );
    expect(
      verifyAnchorSignature({
        envelope: envelope({ signingKeyId: 'other' }),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: otherParts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('rejects a truncated public key without throwing', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope(),
        publicKeyBase64: Buffer.alloc(31, 1).toString('base64'),
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('rejects garbage instead of throwing', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope(),
        publicKeyBase64: 'not-base64',
        signatureBase64: 'also-not-base64',
      }),
    ).toBe(false);
  });

  it('does not verify a different canonical payload produced by a different algorithm tag', () => {
    expect(
      verifyAnchorSignature({
        envelope: envelope({ signatureAlgorithm: 'rsa-sha256' }),
        publicKeyBase64: parts.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(false);
  });

  it('accepts a signature produced with a raw DER base64 private key', () => {
    const der = createPrivateKey(LOCAL.privateKeyPem).export({
      format: 'der',
      type: 'pkcs8',
    });
    const derSigner = createAnchorSigner({
      privateKey: Buffer.from(der).toString('base64'),
      keyId: KEY_ID,
    });
    const derParts = anchorSignedParts(
      derSigner,
      envelope(),
      new Date('2026-10-02T00:05:00.000Z'),
    );
    expect(
      verifyAnchorSignature({
        envelope: envelope(),
        publicKeyBase64: derParts.publicKeyBase64,
        signatureBase64: derParts.signatureBase64,
      }),
    ).toBe(true);
  });
});

describe('requireAnchorSigner', () => {
  it('builds a signer when both values exist', () => {
    const signer = requireAnchorSigner(LOCAL.privateKeyPem, KEY_ID);
    expect(signer.keyId).toBe(KEY_ID);
  });

  it('raises a service unavailable error when unconfigured', () => {
    expect(() => requireAnchorSigner(null, KEY_ID)).toThrow(AppError);
    expect(() => requireAnchorSigner(LOCAL.privateKeyPem, null)).toThrow(/belum dikonfigurasi/);
  });

  it('raises a service unavailable error for an unusable key', () => {
    expect(() => requireAnchorSigner('bukan-kunci', KEY_ID)).toThrow(/tidak dapat dipakai/);
  });
});

describe('generateAnchorKeyPair', () => {
  it('produces a usable pair with a 32 byte public key', () => {
    const pair = generateAnchorKeyPair();
    const signer = createAnchorSigner({ privateKey: pair.privateKeyPem, keyId: KEY_ID });
    const parts = anchorSignedParts(signer, envelope(), new Date('2026-10-02T00:05:00.000Z'));
    expect(
      verifyAnchorSignature({
        envelope: envelope(),
        publicKeyBase64: pair.publicKeyBase64,
        signatureBase64: parts.signatureBase64,
      }),
    ).toBe(true);
  });

  it('never returns the same key twice', () => {
    expect(generateAnchorKeyPair().publicKeyBase64).not.toBe(generateAnchorKeyPair().publicKeyBase64);
  });

  it('keeps the canonical payload hashable for external publication', () => {
    const digest = createHash('sha256')
      .update(canonicalAnchorPayload(envelope()))
      .digest('hex');
    expect(digest).toHaveLength(64);
    void cryptoSign;
  });
});
