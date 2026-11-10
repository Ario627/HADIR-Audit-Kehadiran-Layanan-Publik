import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_ALGORITHM,
  ATTESTATION_DOMAIN,
  ATTESTATION_PUBLIC_KEY_BYTES,
  ATTESTATION_SIGNATURE_BYTES,
  attestationByteLength,
  attestationCaveats,
  attestationIsSigned,
  attestationMatchesContent,
  attestationPayloadFrom,
  canonicalResponsePayload,
  describeAttestation,
  isBodyDigestHex,
  signingKeyFingerprint,
  structuralAttestationError,
  verifyResponseAttestation,
  type AttestationEnvelope,
  type ResponseAttestationInput,
} from './attestation';

const DIGEST = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const PUBLISHED = '2026-10-05T00:00:00.000Z';
const SIGNATURE = Buffer.alloc(ATTESTATION_SIGNATURE_BYTES, 1).toString('base64');
const PUBLIC_KEY = Buffer.alloc(ATTESTATION_PUBLIC_KEY_BYTES, 2).toString('base64');

function input(overrides: Partial<ResponseAttestationInput> = {}): ResponseAttestationInput {
  return {
    reportPublicId: 'LPR-2026-000101',
    institutionId: '0192f0c4-0000-7000-8000-0000000000a1',
    kind: 'initial',
    bodyDigestHex: DIGEST,
    evidenceUrls: [],
    publishedAt: PUBLISHED,
    correctsResponseId: null,
    ...overrides,
  };
}

function envelope(overrides: Partial<AttestationEnvelope> = {}): AttestationEnvelope {
  return {
    ...input(),
    signatureBase64: SIGNATURE,
    signatureAlgorithm: ATTESTATION_ALGORITHM,
    signingKeyId: 'response-key-1',
    publicKeyBase64: PUBLIC_KEY,
    signedAt: PUBLISHED,
    ...overrides,
  };
}

describe('isBodyDigestHex', () => {
  it('accepts a 64 character hex digest', () => {
    expect(isBodyDigestHex(DIGEST)).toBe(true);
  });

  it('rejects short, uppercase, and non hex values', () => {
    expect(isBodyDigestHex('a'.repeat(63))).toBe(false);
    expect(isBodyDigestHex('A'.repeat(64))).toBe(false);
    expect(isBodyDigestHex('z'.repeat(64))).toBe(false);
  });
});

describe('canonicalResponsePayload', () => {
  it('starts with the domain separator so signatures cannot be replayed elsewhere', () => {
    const payload = canonicalResponsePayload(input());
    expect(payload.split('\n')[0]).toBe(ATTESTATION_DOMAIN);
  });

  it('lists every signed field on its own line', () => {
    const lines = canonicalResponsePayload(input()).split('\n');
    expect(lines.some((line) => line === 'report=LPR-2026-000101')).toBe(true);
    expect(lines.some((line) => line === `bodyDigest=${DIGEST}`)).toBe(true);
    expect(lines.some((line) => line === `publishedAt=${PUBLISHED}`)).toBe(true);
    expect(lines.some((line) => line === 'corrects=-')).toBe(true);
  });

  it('marks the absence of evidence explicitly instead of leaving it empty', () => {
    expect(canonicalResponsePayload(input({ evidenceUrls: [] }))).toContain('evidence=-');
  });

  it('joins evidence urls in order', () => {
    const payload = canonicalResponsePayload(
      input({ evidenceUrls: ['https://a.test/1', 'https://a.test/2'] }),
    );
    expect(payload).toContain('evidence=https://a.test/1,https://a.test/2');
  });

  it('drops blank evidence entries so whitespace cannot change the signature', () => {
    const payload = canonicalResponsePayload(
      input({ evidenceUrls: ['https://a.test/1', '   ', ''] }),
    );
    expect(payload).toContain('evidence=https://a.test/1');
  });

  it('trims evidence urls', () => {
    const payload = canonicalResponsePayload(
      input({ evidenceUrls: ['  https://a.test/1  '] }),
    );
    expect(payload).toContain('evidence=https://a.test/1');
  });

  it('lowers the digest case so formatting cannot break verification', () => {
    const payload = canonicalResponsePayload(input({ bodyDigestHex: 'A'.repeat(64) }));
    expect(payload).toContain(`bodyDigest=${'a'.repeat(64)}`);
  });

  it('records the correction target', () => {
    const payload = canonicalResponsePayload(
      input({ correctsResponseId: '0192f0c4-0000-7000-8000-0000000000f1' }),
    );
    expect(payload).toContain('corrects=0192f0c4-0000-7000-8000-0000000000f1');
  });

  it('is stable for identical input', () => {
    expect(canonicalResponsePayload(input())).toBe(canonicalResponsePayload(input()));
  });

  it('changes when any signed field changes', () => {
    const base = canonicalResponsePayload(input());
    expect(canonicalResponsePayload(input({ kind: 'follow_up' }))).not.toBe(base);
    expect(canonicalResponsePayload(input({ bodyDigestHex: DIGEST_B }))).not.toBe(base);
    expect(canonicalResponsePayload(input({ reportPublicId: 'LPR-2026-000102' }))).not.toBe(base);
    expect(
      canonicalResponsePayload(input({ evidenceUrls: ['https://a.test/1'] })),
    ).not.toBe(base);
  });
});

describe('attestationPayloadFrom', () => {
  it('matches canonicalResponsePayload for the same fields', () => {
    expect(attestationPayloadFrom(envelope())).toBe(canonicalResponsePayload(input()));
  });
});

describe('attestationIsSigned', () => {
  it('requires every signature field', () => {
    expect(attestationIsSigned(envelope())).toBe(true);
    expect(attestationIsSigned(envelope({ signatureBase64: null }))).toBe(false);
    expect(attestationIsSigned(envelope({ signingKeyId: null }))).toBe(false);
    expect(attestationIsSigned(envelope({ publicKeyBase64: null }))).toBe(false);
    expect(attestationIsSigned(envelope({ signatureAlgorithm: null }))).toBe(false);
  });
});

describe('attestationByteLength', () => {
  it('measures base64 payloads', () => {
    expect(attestationByteLength(SIGNATURE)).toBe(ATTESTATION_SIGNATURE_BYTES);
    expect(attestationByteLength(PUBLIC_KEY)).toBe(ATTESTATION_PUBLIC_KEY_BYTES);
  });

  it('accepts url safe base64', () => {
    const safe = Buffer.alloc(64, 0xfb).toString('base64url');
    expect(attestationByteLength(safe)).toBe(64);
  });

  it('returns null for null or invalid input', () => {
    expect(attestationByteLength(null)).toBeNull();
    expect(attestationByteLength('')).toBeNull();
    expect(attestationByteLength('not base64!!')).toBeNull();
  });
});

describe('structuralAttestationError', () => {
  it('accepts a well formed signed envelope', () => {
    expect(structuralAttestationError(envelope())).toBeNull();
  });

  it('accepts an unsigned envelope with a valid digest', () => {
    expect(
      structuralAttestationError(
        envelope({
          signatureBase64: null,
          signatureAlgorithm: null,
          signingKeyId: null,
          publicKeyBase64: null,
          signedAt: null,
        }),
      ),
    ).toBeNull();
  });

  it('rejects a malformed digest', () => {
    expect(structuralAttestationError(envelope({ bodyDigestHex: 'abc' }))).toContain('sha256');
  });

  it('rejects an unparsable published time', () => {
    expect(structuralAttestationError(envelope({ publishedAt: 'kemarin' }))).toContain(
      'tanggal yang sah',
    );
  });

  it('rejects a short signature', () => {
    expect(
      structuralAttestationError(
        envelope({ signatureBase64: Buffer.alloc(32, 1).toString('base64') }),
      ),
    ).toContain('64 byte');
  });

  it('rejects a short public key', () => {
    expect(
      structuralAttestationError(
        envelope({ publicKeyBase64: Buffer.alloc(16, 2).toString('base64') }),
      ),
    ).toContain('32 byte');
  });

  it('rejects an unsupported algorithm', () => {
    expect(
      structuralAttestationError(envelope({ signatureAlgorithm: 'rsa-sha256' })),
    ).toContain('tidak didukung');
  });

  it('rejects a blank key id', () => {
    expect(structuralAttestationError(envelope({ signingKeyId: '  ' }))).toContain(
      'ID kunci',
    );
  });
});

describe('verifyResponseAttestation', () => {
  it('verifies when the signature callback accepts', () => {
    const result = verifyResponseAttestation(envelope(), () => true);
    expect(result.status).toBe('verified');
    expect(result.signed).toBe(true);
    expect(result.message).toContain('utuh');
  });

  it('reports a mismatch when the signature callback rejects', () => {
    const result = verifyResponseAttestation(envelope(), () => false);
    expect(result.status).toBe('signature_mismatch');
    expect(result.message).toContain('tidak cocok');
  });

  it('passes the canonical payload to the verifier', () => {
    let received = '';
    verifyResponseAttestation(envelope(), (payload) => {
      received = payload;
      return true;
    });
    expect(received).toBe(canonicalResponsePayload(input()));
  });

  it('reports structural_invalid for a broken signed envelope', () => {
    const result = verifyResponseAttestation(
      envelope({ signatureBase64: Buffer.alloc(8, 1).toString('base64') }),
      () => true,
    );
    expect(result.status).toBe('structural_invalid');
    expect(result.signed).toBe(true);
  });

  it('reports unsigned without calling the verifier', () => {
    let called = false;
    const result = verifyResponseAttestation(
      envelope({
        signatureBase64: null,
        signatureAlgorithm: null,
        signingKeyId: null,
        publicKeyBase64: null,
        signedAt: null,
      }),
      () => {
        called = true;
        return true;
      },
    );
    expect(result.status).toBe('unsigned');
    expect(called).toBe(false);
    expect(result.message).toContain('tidak ditandatangani');
  });

  it('never throws for garbage input', () => {
    expect(() =>
      verifyResponseAttestation(
        envelope({ signatureBase64: '%%%', publicKeyBase64: '%%%' }),
        () => true,
      ),
    ).not.toThrow();
  });
});

describe('attestationMatchesContent', () => {
  it('confirms matching digest, report and institution', () => {
    expect(
      attestationMatchesContent(envelope(), {
        bodyDigestHex: DIGEST,
        reportPublicId: 'LPR-2026-000101',
        institutionId: '0192f0c4-0000-7000-8000-0000000000a1',
      }),
    ).toBe(true);
  });

  it('detects a changed body digest', () => {
    expect(
      attestationMatchesContent(envelope(), {
        bodyDigestHex: DIGEST_B,
        reportPublicId: 'LPR-2026-000101',
        institutionId: '0192f0c4-0000-7000-8000-0000000000a1',
      }),
    ).toBe(false);
  });

  it('detects a different institution', () => {
    expect(
      attestationMatchesContent(envelope(), {
        bodyDigestHex: DIGEST,
        reportPublicId: 'LPR-2026-000101',
        institutionId: 'other',
      }),
    ).toBe(false);
  });
});

describe('describeAttestation', () => {
  it('describes every status in Indonesian', () => {
    expect(describeAttestation(verifyResponseAttestation(envelope(), () => true))).toContain(
      'sah',
    );
    expect(describeAttestation(verifyResponseAttestation(envelope(), () => false))).toContain(
      'tidak cocok',
    );
  });
});

describe('signingKeyFingerprint', () => {
  it('shortens a key for display', () => {
    const fingerprint = signingKeyFingerprint(PUBLIC_KEY);
    expect(fingerprint).toContain('…');
    expect(fingerprint?.length).toBeLessThan(PUBLIC_KEY.length);
  });

  it('returns null without a key', () => {
    expect(signingKeyFingerprint(null)).toBeNull();
  });
});

describe('attestationCaveats', () => {
  it('separates integrity from truth', () => {
    const text = attestationCaveats().join(' ');
    expect(text).toContain('bukan membuktikan isinya benar');
    expect(text).toContain('tetap tidak dapat disunting');
    expect(text).toContain('tidak bergantung pada server HADIR');
  });
});
