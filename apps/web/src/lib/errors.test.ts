import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeError } from './errors';

function apiError(code: string, options: { status?: number; retryAfter?: number } = {}): ApiError {
  return new ApiError('Pesan dari server.', {
    status: options.status ?? 400,
    code,
    retryAfterSeconds: options.retryAfter ?? null,
  });
}

describe('describeError', () => {
  it('memetakan kode QR yang gagal ke aksi manual', () => {
    expect(describeError(apiError('QR_INVALID')).action).toBe('board');
    expect(describeError(apiError('QR_EXPIRED')).title).toContain('kedaluwarsa');
    expect(describeError(apiError('STOP_INACTIVE')).action).toBe('board');
  });

  it('mengarahkan episode ganda ke episode yang sedang berjalan', () => {
    expect(describeError(apiError('EPISODE_ALREADY_ACTIVE')).action).toBe('resume');
  });

  it('menyebut sisa waktu saat terkena batas laju', () => {
    expect(describeError(apiError('RATE_LIMITED', { status: 429, retryAfter: 42 })).detail).toContain(
      '42 detik',
    );
    expect(describeError(apiError('RATE_LIMITED', { status: 429 })).detail).toContain('Tunggu');
  });

  it('memakai pesan server hanya untuk kode yang tidak dikenal', () => {
    const unknown = describeError(apiError('SESUATU_YANG_BARU'));
    expect(unknown.detail).toBe('Pesan dari server.');
    expect(unknown.action).toBe('retry');
  });

  it('tidak membocorkan objek non-ApiError', () => {
    const message = describeError(new Error('boom'));
    expect(message.title).toBe('Permintaan gagal');
    expect(message.detail).not.toContain('boom');
  });

  it('menandai kegagalan kontrak sebagai masalah versi', () => {
    expect(describeError(apiError('CONTRACT_MISMATCH')).detail).toContain('Muat ulang');
  });
});
