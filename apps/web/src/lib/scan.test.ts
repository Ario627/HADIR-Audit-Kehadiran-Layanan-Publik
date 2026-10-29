import { describe, expect, it } from 'vitest';
import { readScannedText, scanErrorCopy, type ScanErrorKind } from './scan';

const ORIGIN = 'https://hadir.id';
const SIGNATURE = 'A'.repeat(22);
const QR_QUERY = `?e=202612&k=ab12&s=${SIGNATURE}&w=30d`;

function expectError(raw: unknown, error: ScanErrorKind): void {
  const outcome = readScannedText(raw, ORIGIN);
  expect(outcome.kind).toBe('error');
  if (outcome.kind === 'error') {
    expect(outcome.error).toBe(error);
  }
}

function expectTarget(raw: unknown, stopCode: string): void {
  const outcome = readScannedText(raw, ORIGIN);
  expect(outcome.kind).toBe('ok');
  if (outcome.kind === 'ok') {
    expect(outcome.target.stopCode).toBe(stopCode);
  }
}

describe('readScannedText with bare codes', () => {
  it('accepts a printed stop code and normalises case', () => {
    expectTarget('bjm-014', 'BJM-014');
    expectTarget('  BJM-014  ', 'BJM-014');
  });

  it('returns an empty search for bare codes', () => {
    const outcome = readScannedText('BJM-014', ORIGIN);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.target.search).toEqual({});
    }
  });

  it('rejects junk that is not a code or a link', () => {
    expectError('halte mana ya', 'not_stop');
    expectError('B', 'not_stop');
    expectError('=', 'not_stop');
  });
});

describe('readScannedText with same-origin links', () => {
  it('accepts an absolute link and keeps the QR proof', () => {
    const outcome = readScannedText(`${ORIGIN}/s/BJM-014${QR_QUERY}`, ORIGIN);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.target.stopCode).toBe('BJM-014');
      expect(outcome.target.search).toEqual({
        e: '202612',
        k: 'ab12',
        s: SIGNATURE,
        w: '30d',
      });
    }
  });

  it('accepts a relative path', () => {
    expectTarget(`/s/BJM-014${QR_QUERY}`, 'BJM-014');
  });

  it('accepts a trailing slash and ignores the hash', () => {
    expectTarget(`/s/BJM-014/${QR_QUERY}#abc`, 'BJM-014');
  });

  it('drops every query key outside the QR contract', () => {
    const outcome = readScannedText(
      `/s/BJM-014${QR_QUERY}&next=//evil.example&redirect=https://evil.example`,
      ORIGIN,
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(Object.keys(outcome.target.search).sort()).toEqual(['e', 'k', 's', 'w']);
    }
  });

  it('ignores an unparseable proof instead of trusting it', () => {
    const outcome = readScannedText('/s/BJM-014?e=abc&k=AB&s=short', ORIGIN);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.target.search).toEqual({});
    }
  });
});

describe('readScannedText refuses foreign targets', () => {
  it('rejects another origin', () => {
    expectError(`https://evil.example/s/BJM-014${QR_QUERY}`, 'foreign_origin');
  });

  it('rejects a protocol-relative link', () => {
    expectError('//evil.example/s/BJM-014', 'foreign_origin');
  });

  it('rejects a link with embedded credentials', () => {
    expectError('https://hadir.id@evil.example/s/BJM-014', 'foreign_origin');
  });

  it('rejects a backslash-smuggled origin', () => {
    expectError('/\\evil.example/s/BJM-014', 'foreign_origin');
    expectError('\\\\evil.example/s/BJM-014', 'not_stop');
  });

  it('rejects non-web schemes', () => {
    expectError('javascript:alert(1)', 'bad_scheme');
    expectError('data:text/html,<script>alert(1)</script>', 'bad_scheme');
    expectError('vbscript:msgbox(1)', 'bad_scheme');
  });
});

describe('readScannedText refuses non-stop pages', () => {
  it('rejects a same-origin page that is not a stop', () => {
    expectError('/transparansi', 'not_stop');
    expectError('/s', 'not_stop');
  });

  it('rejects a too short code path', () => {
    expectError('/s/AB', 'not_stop');
  });

  it('rejects an encoded separator inside the code', () => {
    expectError('/s/BJM%2F014', 'not_stop');
  });
});

describe('readScannedText input guards', () => {
  it('rejects empty and non-string input', () => {
    expectError('', 'empty');
    expectError('   ', 'empty');
    expectError(null, 'empty');
    expectError(undefined, 'empty');
    expectError(42, 'empty');
  });

  it('rejects payloads longer than a QR could usefully carry', () => {
    expectError(`/s/BJM-014?x=${'a'.repeat(600)}`, 'too_long');
  });
});

describe('scanErrorCopy', () => {
  it('returns Indonesian copy for every failure kind', () => {
    const kinds: readonly ScanErrorKind[] = [
      'empty',
      'too_long',
      'bad_scheme',
      'foreign_origin',
      'not_stop',
      'bad_code',
    ];
    for (const kind of kinds) {
      expect(scanErrorCopy(kind).length).toBeGreaterThan(10);
    }
  });

  it('names the foreign origin cause explicitly', () => {
    expect(scanErrorCopy('foreign_origin')).toContain('situs lain');
  });
});
