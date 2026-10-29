import { passwordAcceptable, passwordIssues } from './credential-policy';

const CODES = (value: string): string[] => passwordIssues(value).map((issue) => issue.code);

describe('passwordIssues', () => {
  it('accepts a long varied password', () => {
    expect(passwordAcceptable('kereta-kota-2026-x')).toBe(true);
  });

  it('rejects anything shorter than 12 characters', () => {
    expect(CODES('Pendek1!')).toContain('too_short');
  });

  it('rejects anything longer than 256 characters', () => {
    expect(CODES('aB3!'.repeat(70))).toContain('too_long');
  });

  it('rejects leading and trailing whitespace', () => {
    expect(CODES(' kata-sandi-panjang ')).toContain('edge_whitespace');
  });

  it('allows internal spaces', () => {
    expect(passwordAcceptable('kata sandi panjang')).toBe(true);
  });

  it('rejects common fragments case-insensitively', () => {
    expect(CODES('MyPassword123')).toContain('common_fragment');
    expect(CODES('QWERTYuiop123')).toContain('common_fragment');
    expect(CODES('hadir-jaya-2026')).toContain('common_fragment');
  });

  it('rejects monotonous strings', () => {
    expect(CODES('aaaaaaaaaaaa')).toContain('low_variety');
  });

  it('rejects one repeated character explicitly', () => {
    expect(CODES('bbbbbbbbbbbb')).toContain('single_character');
  });

  it('counts a multi-byte password by characters', () => {
    expect(passwordAcceptable('日本語のパスワード2026')).toBe(true);
  });

  it('reports every problem at once instead of stopping at the first', () => {
    const codes = CODES('aaa');

    expect(codes).toContain('too_short');
    expect(codes).toContain('low_variety');
  });
});
