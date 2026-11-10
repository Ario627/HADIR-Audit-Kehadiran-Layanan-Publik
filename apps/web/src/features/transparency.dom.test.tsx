import type { AnchorPublicKey } from '@hadir/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchorKeys } from './transparency/AnchorProof';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function key(overrides: Partial<AnchorPublicKey> = {}): AnchorPublicKey {
  return {
    algorithm: 'ed25519',
    keyId: 'anchor-2026-11',
    publicKey: 'a'.repeat(44),
    firstAnchoredAt: '2026-11-01T00:00:00.000Z',
    lastAnchoredAt: '2026-11-09T00:00:00.000Z',
    anchorCount: 9,
    ...overrides,
  };
}

function render(keys: readonly AnchorPublicKey[]): void {
  act(() => {
    root.render(<AnchorKeys keys={keys} />);
  });
}

describe('AnchorKeys', () => {
  it('menampilkan keyId, potongan kunci, dan jumlah anchor', () => {
    render([key()]);
    const text = container.textContent ?? '';
    expect(text).toContain('anchor-2026-11');
    expect(text).toContain('9 anchor');
    expect(text).toContain('terakhir');
  });

  it('memakai kalimat jujur saat belum ada anchor', () => {
    render([key({ anchorCount: 0, lastAnchoredAt: null, firstAnchoredAt: null })]);
    expect(container.textContent).toContain('belum dipakai');
    expect(container.textContent).not.toContain('terakhir');
  });

  it('menjelaskan keadaan kosong tanpa mengarang data', () => {
    render([]);
    expect(container.textContent).toContain('Belum ada kunci penanda tangan');
    expect(container.querySelectorAll('.key-row')).toHaveLength(0);
  });
});
