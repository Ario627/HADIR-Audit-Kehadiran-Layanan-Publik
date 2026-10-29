import { describe, expect, it } from 'vitest';
import { canStartAt, stopStatusLabel, stopStatusNote } from './stop-status';

describe('stopStatusNote', () => {
  it('tidak memberi catatan untuk halte aktif', () => {
    expect(stopStatusNote('active')).toBeNull();
  });

  it('memberi catatan peringatan untuk halte pindah', () => {
    const note = stopStatusNote('moved');
    expect(note).not.toBeNull();
    expect(note?.tone).toBe('warn');
    expect(note?.blocksStart).toBe(true);
    expect(note?.title.length).toBeGreaterThan(0);
    expect(note?.body.length).toBeGreaterThan(0);
  });

  it('memberi catatan peringatan untuk halte tidak aktif', () => {
    const note = stopStatusNote('inactive');
    expect(note?.tone).toBe('warn');
    expect(note?.blocksStart).toBe(true);
  });

  it('memberi catatan informasi untuk halte direncanakan', () => {
    const note = stopStatusNote('planned');
    expect(note?.tone).toBe('info');
    expect(note?.blocksStart).toBe(true);
  });

  it('membedakan judul tiap status', () => {
    const titles = ['moved', 'inactive', 'planned'].map((status) =>
      stopStatusNote(status as 'moved' | 'inactive' | 'planned')?.title,
    );
    expect(new Set(titles).size).toBe(3);
  });
});

describe('stopStatusLabel', () => {
  it('memberi label untuk semua status', () => {
    expect(stopStatusLabel('active')).toBe('Aktif');
    expect(stopStatusLabel('inactive')).toBe('Tidak aktif');
    expect(stopStatusLabel('moved')).toBe('Dipindahkan');
    expect(stopStatusLabel('planned')).toBe('Direncanakan');
  });
});

describe('canStartAt', () => {
  it('hanya mengizinkan halte aktif', () => {
    expect(canStartAt('active')).toBe(true);
    expect(canStartAt('inactive')).toBe(false);
    expect(canStartAt('moved')).toBe(false);
    expect(canStartAt('planned')).toBe(false);
  });

  it('sejalan dengan blocksStart', () => {
    const statuses = ['active', 'inactive', 'moved', 'planned'] as const;
    for (const status of statuses) {
      const note = stopStatusNote(status);
      expect(canStartAt(status)).toBe(note === null ? true : !note.blocksStart);
    }
  });
});
