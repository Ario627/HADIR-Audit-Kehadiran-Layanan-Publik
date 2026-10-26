import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './safe-url';

describe('safeExternalUrl', () => {
  it('mempertahankan tautan http dan https', () => {
    expect(safeExternalUrl('https://dinhub.example.go.id/spm')).toBe('https://dinhub.example.go.id/spm');
    expect(safeExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  });

  it('menolak skema yang bisa mengeksekusi atau membaca berkas', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('menolak tautan yang menyisipkan kredensial', () => {
    expect(safeExternalUrl('https://user:rahasia@example.com')).toBeNull();
  });

  it('menolak nilai kosong, relatif, atau rusak', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
    expect(safeExternalUrl('/v1/stops')).toBeNull();
    expect(safeExternalUrl('bukan url')).toBeNull();
  });
});
