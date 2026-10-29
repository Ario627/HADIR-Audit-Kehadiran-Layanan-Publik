import { describe, expect, it } from 'vitest';
import { readQrProof, readQrSearch, readStopCode } from './qr';

describe('readStopCode', () => {
  it('menormalkan huruf kecil dan spasi di tepi', () => {
    expect(readStopCode(' bms-a12 ')).toBe('BMS-A12');
    expect(readStopCode('K3A')).toBe('K3A');
    expect(readStopCode('ABCDEFGHIJKL')).toBe('ABCDEFGHIJKL');
  });

  it('menolak kode di luar pola kontrak', () => {
    expect(readStopCode('AB')).toBeNull();
    expect(readStopCode('ABCDEFGHIJKLM')).toBeNull();
    expect(readStopCode('BMS_A12')).toBeNull();
    expect(readStopCode('-BMS')).toBeNull();
    expect(readStopCode('BMS A12')).toBeNull();
    expect(readStopCode(12)).toBeNull();
    expect(readStopCode(null)).toBeNull();
  });
});

describe('readQrProof', () => {
  const valid = { e: '202610', k: 'bms12345', s: 'A'.repeat(22) };

  it('menerima tiga bagian yang sesuai kontrak', () => {
    expect(readQrProof(valid)).toEqual({ epoch: '202610', keyId: 'bms12345', signature: 'A'.repeat(22) });
    expect(readQrProof({ e: 'r3', k: 'abc', s: '-_'.padEnd(22, 'B') })).not.toBeNull();
  });

  it('menolak signature dengan panjang atau karakter salah', () => {
    expect(readQrProof({ ...valid, s: 'A'.repeat(21) })).toBeNull();
    expect(readQrProof({ ...valid, s: 'A'.repeat(23) })).toBeNull();
    expect(readQrProof({ ...valid, s: `${'A'.repeat(21)}+` })).toBeNull();
    expect(readQrProof({ ...valid, s: `${'A'.repeat(21)}.` })).toBeNull();
  });

  it('menolak kunci, epoch, atau bagian yang hilang', () => {
    expect(readQrProof({ e: '202610', k: undefined, s: 'A'.repeat(22) })).toBeNull();
    expect(readQrProof({ ...valid, e: '2026-10' })).toBeNull();
    expect(readQrProof({ ...valid, k: 'BMS12345' })).toBeNull();
    expect(readQrProof({})).toBeNull();
  });
});

describe('readQrSearch', () => {
  it('memotong nilai panjang agar search state tetap kecil', () => {
    const search = readQrSearch({ e: 'e'.repeat(40), k: 'k'.repeat(40), s: 's'.repeat(40) });
    expect(search.e).toHaveLength(16);
    expect(search.k).toHaveLength(16);
    expect(search.s).toHaveLength(22);
  });

  it('mengabaikan nilai yang bukan string', () => {
    expect(readQrSearch({ e: 1, k: null, s: ['x'] })).toEqual({});
  });
});
