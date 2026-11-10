import { describe, expect, it } from 'vitest';
import {
  ANCHOR_ALGORITHM,
  anchorIsVerified,
  anchorPayloadLines,
  anchorTrustCaveat,
  canonicalAnchorPayload,
  daySequence,
  decodedByteLength,
  sameBase64,
  timelineGaps,
  trustedKeyFor,
  verifyAnchorEnvelope,
  type AnchorEnvelope,
} from './anchor';

const ROOT = Buffer.alloc(32, 7).toString('base64');
const PUBLIC_KEY = Buffer.alloc(32, 3).toString('base64');
const SIGNATURE = Buffer.alloc(64, 9).toString('base64');
const NOW = '2026-10-05T00:00:00.000Z';
const KEY_ID = 'anchor-2026-10';

function envelope(overrides: Partial<AnchorEnvelope> = {}): AnchorEnvelope {
  return {
    anchorDate: '2026-10-01',
    merkleRootBase64: ROOT,
    leafCount: 12,
    windowStart: '2026-10-01T00:00:00.000Z',
    windowEnd: '2026-10-02T00:00:00.000Z',
    signingKeyId: KEY_ID,
    signatureAlgorithm: ANCHOR_ALGORITHM,
    signatureBase64: SIGNATURE,
    publicKeyBase64: PUBLIC_KEY,
    signedAt: '2026-10-02T00:05:00.000Z',
    ...overrides,
  };
}

const TRUSTED = { [KEY_ID]: PUBLIC_KEY };

function verify(overrides: Partial<AnchorEnvelope> = {}, trusted = TRUSTED) {
  return verifyAnchorEnvelope({
    envelope: envelope(overrides),
    now: NOW,
    trustedPublicKeys: trusted,
  });
}

describe('decodedByteLength', () => {
  it('measures 32 and 64 byte payloads exactly', () => {
    expect(decodedByteLength(Buffer.alloc(32).toString('base64'))).toBe(32);
    expect(decodedByteLength(Buffer.alloc(64).toString('base64'))).toBe(64);
  });

  it('returns null for malformed base64', () => {
    expect(decodedByteLength('')).toBeNull();
    expect(decodedByteLength(null)).toBeNull();
    expect(decodedByteLength('not base64!')).toBeNull();
  });
});

describe('canonicalAnchorPayload', () => {
  it('is deterministic and version tagged', () => {
    const first = canonicalAnchorPayload(envelope());
    const second = canonicalAnchorPayload(envelope());
    expect(first).toBe(second);
    expect(first.split('\n')[0]).toBe('hadir-anchor/v1');
    expect(first.endsWith('\n')).toBe(true);
  });

  it('builds one field per line in a fixed order', () => {
    const lines = anchorPayloadLines(envelope());
    expect(lines).toEqual([
      'hadir-anchor/v1',
      'date:2026-10-01',
      `root:${ROOT}`,
      'leaves:12',
      'window_start:2026-10-01T00:00:00.000Z',
      'window_end:2026-10-02T00:00:00.000Z',
      `key:${KEY_ID}`,
      'alg:ed25519',
    ]);
  });

  it('changes when any signed field changes', () => {
    const base = canonicalAnchorPayload(envelope());
    expect(canonicalAnchorPayload(envelope({ leafCount: 13 }))).not.toBe(base);
    expect(canonicalAnchorPayload(envelope({ anchorDate: '2026-10-02' }))).not.toBe(base);
    expect(canonicalAnchorPayload(envelope({ signingKeyId: 'other' }))).not.toBe(base);
    expect(canonicalAnchorPayload(envelope({ signatureAlgorithm: 'rsa' }))).not.toBe(base);
  });

  it('does not include the signature itself', () => {
    const withoutSignature = canonicalAnchorPayload(envelope({ signatureBase64: null }));
    const withSignature = canonicalAnchorPayload(envelope());
    expect(withoutSignature).toBe(withSignature);
  });
});

describe('sameBase64', () => {
  it('ignores padding differences', () => {
    expect(sameBase64('AAA=', 'AAA')).toBe(true);
    expect(sameBase64('AAA', 'AAA==')).toBe(true);
  });

  it('rejects null and different payloads', () => {
    expect(sameBase64(null, 'AAA')).toBe(false);
    expect(sameBase64('AAA', null)).toBe(false);
    expect(sameBase64('AAA', 'AAB')).toBe(false);
  });
});

describe('trustedKeyFor', () => {
  it('returns the key for a known id', () => {
    expect(trustedKeyFor(TRUSTED, KEY_ID)).toBe(PUBLIC_KEY);
  });

  it('returns null for unknown ids and null input', () => {
    expect(trustedKeyFor(TRUSTED, 'unknown')).toBeNull();
    expect(trustedKeyFor(TRUSTED, null)).toBeNull();
    expect(trustedKeyFor({}, KEY_ID)).toBeNull();
  });
});

describe('verifyAnchorEnvelope', () => {
  it('accepts a complete, trusted, well formed anchor', () => {
    const result = verify();
    expect(result.status).toBe('verified');
    expect(result.signed).toBe(true);
    expect(result.keyTrusted).toBe(true);
    expect(anchorIsVerified(result)).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('reports an unsigned anchor instead of pretending it is verified', () => {
    const result = verify({
      signatureBase64: null,
      signatureAlgorithm: null,
      signingKeyId: null,
      publicKeyBase64: null,
      signedAt: null,
    });
    expect(result.status).toBe('signature_missing');
    expect(result.signed).toBe(false);
    expect(result.warnings).toContain('anchor_unsigned');
    expect(anchorIsVerified(result)).toBe(false);
  });

  it('rejects a signature with the wrong length', () => {
    const result = verify({ signatureBase64: Buffer.alloc(63, 1).toString('base64') });
    expect(result.status).toBe('signature_invalid');
    expect(result.signatureWellFormed).toBe(false);
  });

  it('rejects a public key with the wrong length', () => {
    const result = verify({ publicKeyBase64: Buffer.alloc(31, 1).toString('base64') });
    expect(result.checks.find((check) => check.code === 'public_key_length')?.ok).toBe(false);
  });

  it('flags an unknown key id as untrusted', () => {
    const result = verify({ signingKeyId: 'rotated-away' });
    expect(result.keyTrusted).toBe(false);
    expect(result.status).toBe('key_mismatch');
    expect(result.warnings).toContain('untrusted_key');
  });

  it('flags a public key that does not match the trusted value', () => {
    const result = verify({ publicKeyBase64: Buffer.alloc(32, 4).toString('base64') });
    expect(result.status).toBe('key_mismatch');
  });

  it('detects a root that does not match the recomputation', () => {
    const result = verifyAnchorEnvelope({
      envelope: envelope(),
      now: NOW,
      trustedPublicKeys: TRUSTED,
      recomputedRootBase64: Buffer.alloc(32, 8).toString('base64'),
    });
    expect(result.status).toBe('root_mismatch');
    expect(result.rootMatches).toBe(false);
  });

  it('detects a leaf count that does not match the recomputation', () => {
    const result = verifyAnchorEnvelope({
      envelope: envelope(),
      now: NOW,
      trustedPublicKeys: TRUSTED,
      recomputedLeafCount: 13,
    });
    expect(result.status).toBe('root_mismatch');
  });

  it('warns when nothing was recomputed', () => {
    expect(verify().warnings).toContain('root_not_recomputed');
  });

  it('rejects a signature dated before the window closed', () => {
    const result = verify({ signedAt: '2026-10-01T12:00:00.000Z' });
    expect(result.status).toBe('window_inconsistent');
  });

  it('rejects a signature dated in the future', () => {
    const result = verify({ signedAt: '2026-12-01T00:00:00.000Z' });
    expect(result.status).toBe('future_dated');
  });

  it('tolerates small clock skew into the future', () => {
    const result = verify({ signedAt: '2026-10-05T00:02:00.000Z' });
    expect(result.checks.find((check) => check.code === 'signed_not_future')?.ok).toBe(true);
  });

  it('rejects a malformed anchor date', () => {
    const result = verify({ anchorDate: '1 Oktober 2026' });
    expect(result.checks.find((check) => check.code === 'anchor_date')?.ok).toBe(false);
  });

  it('rejects a root with the wrong byte length', () => {
    const result = verify({ merkleRootBase64: Buffer.alloc(31, 1).toString('base64') });
    expect(result.checks.find((check) => check.code === 'root_length')?.ok).toBe(false);
    expect(anchorIsVerified(result)).toBe(false);
  });

  it('rejects an inverted window', () => {
    const result = verify({
      windowStart: '2026-10-02T00:00:00.000Z',
      windowEnd: '2026-10-01T00:00:00.000Z',
    });
    expect(result.status).toBe('window_inconsistent');
  });

  it('rejects a window that does not start on the anchored date', () => {
    const result = verify({
      windowStart: '2026-10-02T00:00:00.000Z',
      windowEnd: '2026-10-03T00:00:00.000Z',
    });
    expect(result.checks.find((check) => check.code === 'window_matches_date')?.ok).toBe(false);
  });

  it('rejects a negative leaf count', () => {
    const result = verify({ leafCount: -1 });
    expect(result.checks.find((check) => check.code === 'leaf_count')?.ok).toBe(false);
  });

  it('handles an unparsable now without throwing', () => {
    const result = verifyAnchorEnvelope({
      envelope: envelope(),
      now: 'bukan waktu',
      trustedPublicKeys: TRUSTED,
    });
    expect(result.checks.find((check) => check.code === 'now_parsable')?.ok).toBe(false);
    expect(anchorIsVerified(result)).toBe(false);
  });
});

describe('timelineGaps', () => {
  it('collects missing, unsigned and unverified days', () => {
    const gaps = timelineGaps([
      { date: '2026-10-01', status: 'verified' },
      { date: '2026-10-02', status: 'missing' },
      { date: '2026-10-03', status: 'unsigned' },
      { date: '2026-10-04', status: 'root_mismatch' },
    ]);
    expect(gaps).toEqual([
      { date: '2026-10-02', reason: 'missing' },
      { date: '2026-10-03', reason: 'unsigned' },
      { date: '2026-10-04', reason: 'unverified' },
    ]);
  });

  it('returns nothing when every day verifies', () => {
    expect(
      timelineGaps([
        { date: '2026-10-01', status: 'verified' },
        { date: '2026-10-02', status: 'verified' },
      ]),
    ).toEqual([]);
  });
});

describe('daySequence', () => {
  it('enumerates inclusive days', () => {
    expect(daySequence('2026-10-01', '2026-10-04')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('handles a single day', () => {
    expect(daySequence('2026-10-01', '2026-10-01')).toEqual(['2026-10-01']);
  });

  it('returns empty for an inverted or invalid range', () => {
    expect(daySequence('2026-10-04', '2026-10-01')).toEqual([]);
    expect(daySequence('x', '2026-10-01')).toEqual([]);
  });
});

describe('anchorTrustCaveat', () => {
  it('states the integrity versus truth boundary', () => {
    const caveat = anchorTrustCaveat();
    expect(caveat).toContain('integritas');
    expect(caveat).toContain('bukan kebenaran isi');
  });
});
