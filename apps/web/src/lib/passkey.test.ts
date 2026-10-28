import { describe, expect, it } from 'vitest';
import {
  classifyCeremonyError,
  describePasskeyError,
  passkeyFailureText,
  type PasskeyFailure,
} from './passkey';

const KINDS: readonly PasskeyFailure['kind'][] = [
  'unsupported',
  'cancelled',
  'already_registered',
  'needs_user_verification',
  'domain_mismatch',
  'no_algorithm',
  'failed',
];

function withCode(code: string): unknown {
  const error = new Error('ceremony failed');
  return Object.assign(error, { code });
}

function withName(name: string): unknown {
  const error = new Error('ceremony failed');
  error.name = name;
  return error;
}

describe('classifyCeremonyError', () => {
  it('maps every documented library code', () => {
    expect(classifyCeremonyError(withCode('ERROR_CEREMONY_ABORTED'))).toEqual({ kind: 'cancelled' });
    expect(classifyCeremonyError(withCode('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'))).toEqual({
      kind: 'already_registered',
    });
    expect(
      classifyCeremonyError(withCode('ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT')),
    ).toEqual({ kind: 'needs_user_verification' });
    expect(classifyCeremonyError(withCode('ERROR_INVALID_DOMAIN'))).toEqual({
      kind: 'domain_mismatch',
    });
    expect(classifyCeremonyError(withCode('ERROR_INVALID_RP_ID'))).toEqual({
      kind: 'domain_mismatch',
    });
    expect(
      classifyCeremonyError(withCode('ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG')),
    ).toEqual({ kind: 'no_algorithm' });
  });

  it('falls back to failed for an unknown library code', () => {
    expect(classifyCeremonyError(withCode('ERROR_SOMETHING_NEW'))).toEqual({ kind: 'failed' });
  });

  it('classifies a plain DOMException by name', () => {
    expect(classifyCeremonyError(withName('NotAllowedError'))).toEqual({ kind: 'cancelled' });
    expect(classifyCeremonyError(withName('AbortError'))).toEqual({ kind: 'cancelled' });
    expect(classifyCeremonyError(withName('SecurityError'))).toEqual({ kind: 'domain_mismatch' });
    expect(classifyCeremonyError(withName('NotSupportedError'))).toEqual({ kind: 'unsupported' });
    expect(classifyCeremonyError(withName('TypeError'))).toEqual({ kind: 'failed' });
  });

  it('never throws on hostile input', () => {
    expect(classifyCeremonyError(null)).toEqual({ kind: 'failed' });
    expect(classifyCeremonyError(undefined)).toEqual({ kind: 'failed' });
    expect(classifyCeremonyError('boom')).toEqual({ kind: 'failed' });
    expect(classifyCeremonyError(42)).toEqual({ kind: 'failed' });
    expect(classifyCeremonyError({ code: 7 })).toEqual({ kind: 'failed' });
    expect(classifyCeremonyError({ code: 'x'.repeat(200) })).toEqual({ kind: 'failed' });
  });

  it('prefers the library code over the error name', () => {
    const error = Object.assign(new Error('x'), {
      name: 'NotAllowedError',
      code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
    });
    expect(classifyCeremonyError(error)).toEqual({ kind: 'already_registered' });
  });
});

describe('passkeyFailureText', () => {
  it('has Indonesian copy for every failure kind', () => {
    for (const kind of KINDS) {
      const text = passkeyFailureText({ kind });
      expect(text.length).toBeGreaterThan(20);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('explains the configuration failure honestly instead of blaming the user', () => {
    expect(passkeyFailureText({ kind: 'domain_mismatch' })).toContain('kesalahan konfigurasi');
  });

  it('reassures that a cancel changes nothing', () => {
    expect(passkeyFailureText({ kind: 'cancelled' })).toContain('Tidak ada yang berubah');
  });
});

describe('describePasskeyError', () => {
  it('passes a short message through', () => {
    expect(describePasskeyError(new Error('gagal'))).toBe('gagal');
  });

  it('caps a long message', () => {
    expect(describePasskeyError(new Error('a'.repeat(900)))).toHaveLength(300);
  });

  it('substitutes a fallback for unusable errors', () => {
    expect(describePasskeyError(null)).toBe('Passkey gagal dibuat.');
    expect(describePasskeyError({})).toBe('Passkey gagal dibuat.');
    expect(describePasskeyError(new Error(''))).toBe('Passkey gagal dibuat.');
  });
});
