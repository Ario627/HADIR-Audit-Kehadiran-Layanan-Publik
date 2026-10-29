import { chainHashOf, inspectChain, payloadHashOf, type StoredEvent } from '../../db/repositories/chain.repository';
import type { Transaction } from '../../db/client';
import type { TransactionRunner } from '../../db/transaction-runner';
import { auditStub, recordingAudit } from '../../test-support/audit.stub';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { ChainRepository } from '../../db/repositories/chain.repository';
import {
  dayWindow,
  toTransparencyAnchor,
  TransparencyService,
  verifyUrlFor,
} from './transparency.service';

const passthroughRunner: TransactionRunner = async (work) => work({} as Transaction);

const SESSION: PlatformAdminSession = {
  sessionId: '0192f0c4-0000-7000-8000-0000000000f1',
  adminId: '0192f0c4-0000-7000-8000-0000000000f2',
  email: 'ops@hadir.id',
  displayName: 'Operator',
  role: 'superadmin',
  createdAt: new Date('2026-10-28T00:00:00.000Z'),
  lastSeenAt: new Date('2026-10-28T00:00:00.000Z'),
  expiresAt: new Date('2026-10-28T08:00:00.000Z'),
  revokedAt: null,
};

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  const base: StoredEvent = {
    reportId: 'r1',
    publicId: 'LPR-2026-000001',
    seq: 1,
    kind: 'submitted',
    payload: { a: 1 },
    prevHash: Buffer.alloc(32),
    payloadHash: payloadHashOf({ a: 1 }),
    chainHash: Buffer.alloc(32),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  };
  const merged = { ...base, ...overrides };
  const payloadHash = payloadHashOf(merged.payload);
  return {
    ...merged,
    payloadHash: overrides.payloadHash ?? payloadHash,
    chainHash: overrides.chainHash ?? chainHashOf(merged.prevHash, payloadHash),
  };
}

function chained(): StoredEvent[] {
  const first = event({ seq: 1, payload: { step: 1 } });
  const second = event({
    seq: 2,
    payload: { step: 2 },
    prevHash: first.chainHash,
  });
  return [first, second];
}

describe('dayWindow', () => {
  it('builds a UTC day boundary', () => {
    const window = dayWindow('2026-10-24');
    expect(window.start.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('rejects a malformed date', () => {
    expect(() => dayWindow('24-10-2026')).toThrow();
    expect(() => dayWindow('2026-13-01')).toThrow();
  });

});

describe('inspectChain', () => {
  it('accepts a well formed chain', () => {
    expect(inspectChain(chained())).toEqual([]);
  });

  it('accepts an empty chain', () => {
    expect(inspectChain([])).toEqual([]);
  });

  it('flags a gap in the sequence', () => {
    const broken = chained();
    broken[1] = { ...broken[1]!, seq: 3 };
    const reasons = inspectChain(broken).map((item) => item.reason);
    expect(reasons).toContain('gap');
  });

  it('flags a wrong previous hash', () => {
    const broken = chained();
    broken[1] = { ...broken[1]!, prevHash: Buffer.alloc(32, 9) };
    const reasons = inspectChain(broken).map((item) => item.reason);
    expect(reasons).toContain('prev_mismatch');
  });

  it('flags a tampered payload', () => {
    const broken = chained();
    broken[0] = { ...broken[0]!, payload: { step: 99 } };
    const reasons = inspectChain(broken).map((item) => item.reason);
    expect(reasons).toContain('payload_mismatch');
  });

  it('flags a tampered chain hash', () => {
    const broken = chained();
    broken[0] = { ...broken[0]!, chainHash: Buffer.alloc(32, 7) };
    const reasons = inspectChain(broken).map((item) => item.reason);
    expect(reasons).toContain('chain_mismatch');
  });

  it('reports the report and sequence of every break', () => {
    const broken = chained();
    broken[1] = { ...broken[1]!, prevHash: Buffer.alloc(32, 9) };
    const [first] = inspectChain(broken);
    expect(first?.reportPublicId).toBe('LPR-2026-000001');
    expect(first?.seq).toBe(2);
  });
});

describe('toTransparencyAnchor', () => {
  it('encodes the root as base64 and links the public verifier', () => {
    const anchor = toTransparencyAnchor({
      anchorDate: '2026-10-01',
      merkleRoot: Buffer.alloc(32, 3),
      leafCount: 12,
      windowStart: new Date('2026-10-01T00:00:00.000Z'),
      windowEnd: new Date('2026-10-02T00:00:00.000Z'),
      txRef: null,
      proof: {},
      createdAt: new Date('2026-10-02T00:05:00.000Z'),
    });
    expect(anchor.merkleRoot).toBe(Buffer.alloc(32, 3).toString('base64'));
    expect(anchor.eventCount).toBe(12);
    expect(anchor.verifyUrl).toBe(verifyUrlFor('2026-10-01'));
    expect(anchor.publishedAt).toBe('2026-10-02T00:05:00.000Z');
  });
});

describe('TransparencyService.seal', () => {
  const repositoryDouble = (overrides: Partial<ChainRepository> = {}): ChainRepository =>
    ({
      findAnchor: async () => null,
      listChainHashesInWindow: async () => [Buffer.alloc(32, 1)],
      insertAnchor: async (_tx: unknown, input: { anchorDate: string; merkleRoot: Buffer; leafCount: number }) => ({
        anchorDate: input.anchorDate,
        merkleRoot: input.merkleRoot,
        leafCount: input.leafCount,
        windowStart: new Date('2026-10-01T00:00:00.000Z'),
        windowEnd: new Date('2026-10-02T00:00:00.000Z'),
        txRef: null,
        proof: {},
        createdAt: new Date('2026-10-02T00:00:01.000Z'),
      }),
      ...overrides,
    }) as unknown as ChainRepository;

  it('refuses to seal a day that has not finished', async () => {
    const service = new TransparencyService(
      repositoryDouble(),
      auditStub(),
      passthroughRunner,
    );
    await expect(
      service.seal('2026-10-28', SESSION, 'req-1', new Date('2026-10-28T10:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses to seal a day with no events', async () => {
    const service = new TransparencyService(
      repositoryDouble({ listChainHashesInWindow: async () => [] }),
      auditStub(),
      passthroughRunner,
    );
    await expect(
      service.seal('2026-10-01', SESSION, 'req-2', new Date('2026-10-05T00:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the existing anchor without minting a second one', async () => {
    const existing = {
      anchorDate: '2026-10-01',
      merkleRoot: Buffer.alloc(32, 5),
      leafCount: 3,
      windowStart: new Date('2026-10-01T00:00:00.000Z'),
      windowEnd: new Date('2026-10-02T00:00:00.000Z'),
      txRef: null,
      proof: {},
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    };
    let insertCalls = 0;
    const service = new TransparencyService(
      repositoryDouble({
        findAnchor: async () => existing,
        insertAnchor: async () => {
          insertCalls += 1;
          return null;
        },
      }),
      auditStub(),
      passthroughRunner,
    );
    const anchor = await service.seal(
      '2026-10-01',
      SESSION,
      'req-3',
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(anchor.eventCount).toBe(3);
    expect(insertCalls).toBe(0);
  });

  it('mints an anchor for a finished day', async () => {
    const audit = recordingAudit();
    const service = new TransparencyService(
      repositoryDouble(),
      audit.service,
      passthroughRunner,
    );
    const anchor = await service.seal(
      '2026-10-01',
      SESSION,
      'req-4',
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(anchor.date).toBe('2026-10-01');
    expect(anchor.eventCount).toBe(1);
    expect(audit.records[0]?.action).toBe('admin.anchor_sealed');
  });
});

describe('TransparencyService.verify', () => {
  it('reports a clean chain', async () => {
    const audit = recordingAudit();
    const service = new TransparencyService(
      {
        listReportIds: async () => ['r1'],
        listEventsForReport: async () => chained(),
      } as unknown as ChainRepository,
      audit.service,
      passthroughRunner,
    );
    const result = await service.verify({ maxReports: 10 }, SESSION, 'req-5');
    expect(result.ok).toBe(true);
    expect(result.checkedEvents).toBe(2);
    expect(result.breaks).toEqual([]);
    expect(audit.records[0]?.action).toBe('admin.chain_verify');
  });

  it('reports a tampered chain', async () => {
    const tampered = chained();
    tampered[0] = { ...tampered[0]!, payload: { step: 99 } };
    const service = new TransparencyService(
      {
        listReportIds: async () => ['r1'],
        listEventsForReport: async () => tampered,
      } as unknown as ChainRepository,
      auditStub(),
      passthroughRunner,
    );
    const result = await service.verify({ maxReports: 10 }, SESSION, 'req-6');
    expect(result.ok).toBe(false);
    expect(result.breaks.length).toBeGreaterThan(0);
  });

  it('honours the since and until window', async () => {
    const service = new TransparencyService(
      {
        listReportIds: async () => ['r1'],
        listEventsForReport: async () => chained(),
      } as unknown as ChainRepository,
      auditStub(),
      passthroughRunner,
    );
    const result = await service.verify(
      {
        since: '2026-10-02T00:00:00.000Z',
        until: '2026-10-03T00:00:00.000Z',
        maxReports: 10,
      },
      SESSION,
      'req-7',
    );
    expect(result.checkedEvents).toBe(0);
  });
});
