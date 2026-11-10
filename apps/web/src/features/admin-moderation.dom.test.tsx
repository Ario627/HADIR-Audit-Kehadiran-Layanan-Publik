import type { AdminReportDetail } from '@hadir/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModerationDecision } from './admin/ModerationDecision';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const REPORT: AdminReportDetail = {
  publicId: 'LPR-2026-000123',
  category: 'service_wait',
  status: 'submitted',
  moderation: 'pending',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  institutionName: 'Dishub Banyumas',
  text: 'Bus tidak datang selama dua puluh menit.',
  evidenceLevel: 'indication',
  corroborationCount: 2,
  createdAt: '2026-11-10T03:00:00.000Z',
  followUpAt: null,
  resolvedAt: null,
  evidenceScore: 0.42,
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode): void {
  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === name,
  );
  if (found === undefined) {
    throw new Error(`tombol ${name} tidak ada`);
  }
  return found as HTMLButtonElement;
}

function type(selector: string, value: string): void {
  const field = container.querySelector(selector);
  if (field === null) {
    throw new Error(`field ${selector} tidak ada`);
  }
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value') as
    | { set?: (this: HTMLElement, value: string) => void }
    | undefined;
  const setter = descriptor?.set;
  if (setter === undefined) {
    throw new Error('setter value tidak tersedia');
  }
  act(() => {
    setter.call(field as HTMLElement, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ModerationDecision', () => {
  it('never offers a rejection without a reason of ten characters', () => {
    render(<ModerationDecision report={REPORT} />);

    expect(button('Simpan keputusan').disabled).toBe(true);

    act(() => {
      button('Tolak').click();
    });
    expect(container.textContent).toContain('Minimal 10 karakter');
    expect(button('Simpan keputusan').disabled).toBe(true);

    type('#moderation-reason', 'pendek');
    expect(button('Simpan keputusan').disabled).toBe(true);

    type('#moderation-reason', 'Laporan tidak menyebut waktu dan arah perjalanan.');
    expect(button('Simpan keputusan').disabled).toBe(false);
  });

  it('approves without a reason and reports what changed', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            publicId: REPORT.publicId,
            moderation: 'approved',
            previousModeration: 'pending',
            mediaUpdated: 1,
          },
          meta: { requestId: 'req-1', generatedAt: '2026-11-10T03:00:00.000Z' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ModerationDecision report={REPORT} />);

    act(() => {
      button('Izinkan tampil').click();
    });
    await act(async () => {
      button('Simpan keputusan').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const moderation = calls.find((entry) => String(entry[0]).includes('/moderation'));
    expect(moderation).toBeDefined();
    expect(String(moderation?.[0])).toContain(`/v1/admin/reports/${REPORT.publicId}/moderation`);
    expect(moderation?.[1].method).toBe('PATCH');
    expect(JSON.stringify(moderation?.[1].body)).not.toContain('reason');
    expect(container.textContent).toContain('berubah dari menunggu ke lolos');
  });

  it('shows the server message when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            type: 'https://hadir.id/problems/validation-failed',
            title: 'Validasi gagal',
            status: 422,
            detail: 'Alasan wajib diisi.',
            code: 'VALIDATION_FAILED',
          }),
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    render(<ModerationDecision report={REPORT} />);

    act(() => {
      button('Karantina').click();
    });
    type('#moderation-reason', 'Perlu pemeriksaan lanjutan atas lampiran.');
    await act(async () => {
      button('Simpan keputusan').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    expect(container.innerHTML).toContain('role="alert"');
  });
});
