import { describe, expect, it } from 'vitest';
import { syncMessage } from './SyncStatus';

describe('syncMessage', () => {
  it('mengutamakan status simpan yang sedang berjalan', () => {
    expect(syncMessage(false, 'saving', 'server')).toBe('Menyimpan ke server…');
  });

  it('menjelaskan bahwa catatan tidak hilang saat gagal', () => {
    expect(syncMessage(true, 'error', 'server')).toContain('tetap ada di perangkat');
  });

  it('membedakan server tidak terjangkau dari offline', () => {
    expect(syncMessage(true, 'unreachable', 'device')).toContain('tidak terjangkau');
    expect(syncMessage(false, 'idle', 'server')).toContain('Offline');
  });

  it('menyebut lokasi penyimpanan saat semuanya normal', () => {
    expect(syncMessage(true, 'idle', 'server')).toBe('Tersimpan di server');
    expect(syncMessage(true, 'idle', 'device')).toBe('Tersimpan di perangkat');
  });
});
