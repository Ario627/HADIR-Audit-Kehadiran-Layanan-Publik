import type { CaseFile } from '@hadir/contracts';
import type { Request, Response } from 'express';
import { AccountabilityController } from './accountability.controller';
import type { AccountabilityService } from './accountability.service';

const PUBLIC_ID = 'LPR-2026-000001';
const DEVICE_HASH = 'a'.repeat(64);

function caseFile(): CaseFile {
  return {
    publicId: PUBLIC_ID,
    status: 'submitted',
    category: 'service_wait',
    createdAt: '2026-11-01T00:00:00.000Z',
    milestones: {
      entries: [],
      current: 'submitted',
      next: 'triaged',
      progress: 0,
      terminal: null,
      pendingInfoRequest: false,
      gaps: [],
      caveats: [],
    },
    sla: null,
    responses: [],
    verifications: [],
    resolution: {
      outcome: 'undecided',
      reason: 'Belum ada bukti.',
      supporting: 0,
      refuting: 0,
      inconclusive: 0,
      conflicts: [],
      cautions: [],
    },
    caveats: [],
  };
}

function requestWith(isNew: boolean): Request {
  return {
    context: {
      requestId: 'req-1',
      device: { hash: DEVICE_HASH, dayHash: 'b'.repeat(64), isNew },
      actor: { kind: 'citizen', deviceHash: DEVICE_HASH },
    },
  } as unknown as Request;
}

function responseDouble(): {
  response: Response;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
  } as unknown as Response;
  return { response, headers };
}

function build(calls: Array<string | undefined>) {
  const service = {
    caseFile: async (_publicId: string, deviceHash?: string) => {
      calls.push(deviceHash);
      return caseFile();
    },
  } as unknown as AccountabilityService;
  return new AccountabilityController(service);
}

describe('AccountabilityController.caseFile', () => {
  it('keeps the public cache for visitors without a device cookie', async () => {
    const calls: Array<string | undefined> = [];
    const controller = build(calls);
    const { response, headers } = responseDouble();

    await controller.caseFile(PUBLIC_ID, undefined, requestWith(true), response);

    expect(calls).toEqual([undefined]);
    expect(headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(headers.get('vary')).toBe('Cookie');
  });

  it('marks the response private when the owner reads their own case', async () => {
    const calls: Array<string | undefined> = [];
    const controller = build(calls);
    const { response, headers } = responseDouble();

    await controller.caseFile(PUBLIC_ID, undefined, requestWith(false), response);

    expect(calls).toEqual([DEVICE_HASH]);
    expect(headers.get('cache-control')).toBe('private, no-store');
  });
});
