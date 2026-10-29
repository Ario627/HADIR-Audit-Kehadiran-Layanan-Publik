import { describe, expect, it } from 'vitest';
import {
  HELP_KEY,
  LEADER_KEY,
  LEADER_TIMEOUT_MS,
  LEADER_TARGETS,
  comboLabel,
  isHelpKey,
  isTextEntry,
  isTypingContext,
  stepLeader,
  targetForLeader,
  type KeyContext,
  type LeaderStep,
} from './shortcuts';

function ctx(overrides: Partial<KeyContext> = {}): KeyContext {
  return {
    key: 'g',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    tagName: 'BODY',
    isEditable: false,
    ...overrides,
  };
}

const NOW = 1_760_000_000_000;
const IDLE: LeaderStep = { kind: 'idle' };

describe('isTextEntry', () => {
  it('mengenali kolom isian native', () => {
    expect(isTextEntry('INPUT', false)).toBe(true);
    expect(isTextEntry('textarea', false)).toBe(true);
    expect(isTextEntry('SELECT', false)).toBe(true);
  });

  it('mengenali elemen yang bisa disunting', () => {
    expect(isTextEntry('DIV', true)).toBe(true);
  });

  it('menganggap elemen lain bukan kolom isian', () => {
    expect(isTextEntry('BODY', false)).toBe(false);
    expect(isTextEntry('BUTTON', false)).toBe(false);
  });
});

describe('isTypingContext', () => {
  it('benar saat fokus di kolom isian', () => {
    expect(isTypingContext(ctx({ tagName: 'INPUT' }))).toBe(true);
  });

  it('benar saat tombol perintah ditekan', () => {
    expect(isTypingContext(ctx({ metaKey: true }))).toBe(true);
    expect(isTypingContext(ctx({ ctrlKey: true }))).toBe(true);
    expect(isTypingContext(ctx({ altKey: true }))).toBe(true);
  });

  it('salah pada halaman biasa', () => {
    expect(isTypingContext(ctx())).toBe(false);
  });
});

describe('isHelpKey', () => {
  it('mengenali tanda tanya', () => {
    expect(isHelpKey(ctx({ key: HELP_KEY }))).toBe(true);
  });

  it('mengabaikan tanda tanya di kolom isian', () => {
    expect(isHelpKey(ctx({ key: HELP_KEY, tagName: 'INPUT' }))).toBe(false);
  });
});

describe('targetForLeader', () => {
  it('memetakan setiap huruf ke path absolut', () => {
    for (const [key, target] of Object.entries(LEADER_TARGETS)) {
      expect(target.path.startsWith('/')).toBe(true);
      expect(target.label.length).toBeGreaterThan(0);
      expect(targetForLeader(key)).toEqual(target);
    }
  });

  it('menolak huruf yang tidak terdaftar', () => {
    expect(targetForLeader('z')).toBeNull();
  });

  it('tidak membaca prototipe objek', () => {
    expect(targetForLeader('toString')).toBeNull();
    expect(targetForLeader('__proto__')).toBeNull();
  });
});

describe('stepLeader', () => {
  it('menunggu setelah awalan ditekan', () => {
    const next = stepLeader(IDLE, ctx({ key: LEADER_KEY }), NOW);
    expect(next).toEqual({ kind: 'pending', at: NOW });
  });

  it('berpindah saat huruf tujuan menyusul', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    const next = stepLeader(pending, ctx({ key: 'p' }), NOW + 200);
    expect(next).toEqual({ kind: 'navigate', path: '/peta' });
  });

  it('menerima huruf besar', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    expect(stepLeader(pending, ctx({ key: 'L' }), NOW + 100)).toEqual({
      kind: 'navigate',
      path: '/lapor',
    });
  });

  it('menolak huruf tujuan yang tidak terdaftar', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    expect(stepLeader(pending, ctx({ key: 'z' }), NOW + 100)).toEqual({ kind: 'idle' });
  });

  it('membatalkan awalan yang kedaluwarsa', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    const late = stepLeader(pending, ctx({ key: 'p' }), NOW + LEADER_TIMEOUT_MS + 1);
    expect(late).toEqual({ kind: 'idle' });
  });

  it('tetap menerima tepat pada batas waktu', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    expect(stepLeader(pending, ctx({ key: 'b' }), NOW + LEADER_TIMEOUT_MS)).toEqual({
      kind: 'navigate',
      path: '/',
    });
  });

  it('tidak bereaksi saat fokus di kolom isian', () => {
    expect(stepLeader(IDLE, ctx({ key: LEADER_KEY, tagName: 'INPUT' }), NOW)).toEqual({
      kind: 'idle',
    });
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    expect(stepLeader(pending, ctx({ key: 'p', tagName: 'TEXTAREA' }), NOW + 10)).toEqual({
      kind: 'idle',
    });
  });

  it('mengabaikan tombol khusus', () => {
    expect(stepLeader(IDLE, ctx({ key: 'Shift' }), NOW)).toEqual({ kind: 'idle' });
    expect(stepLeader(IDLE, ctx({ key: 'ArrowDown' }), NOW)).toEqual({ kind: 'idle' });
  });

  it('mengulang awalan memperbarui waktu tunggu', () => {
    const pending: LeaderStep = { kind: 'pending', at: NOW };
    const again = stepLeader(pending, ctx({ key: LEADER_KEY }), NOW + 900);
    expect(again).toEqual({ kind: 'idle' });
  });
});

describe('comboLabel', () => {
  it('menyebut awalan dan huruf tujuan', () => {
    expect(comboLabel('p')).toBe('G lalu P');
  });
});
