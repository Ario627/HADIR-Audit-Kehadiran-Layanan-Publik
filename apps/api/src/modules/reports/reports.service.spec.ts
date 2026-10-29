import { auditStub } from '../../test-support/audit.stub';
import type { UploadsService } from '../uploads/uploads.service';
import type { Transaction } from '../../db/client';
import type { TransactionRunner } from '../../db/transaction-runner';
import type { ReportDetail } from '@hadir/contracts';
import type { DeviceIdentity } from '../../common/http/request-context';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type {
  InsertReportValues,
  ReportRow,
  ReportsRepository,
} from '../../db/repositories/reports.repository';
import { assertUsableText, sanitizeNote, sanitizeText } from './reports.text';
import { statusAfterClosure } from './reports.mapper';
import { ReportsService } from './reports.service';

const passthroughRunner: TransactionRunner = async (work) => work({} as Transaction);

const STOP_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const REPORT_ID = '0192f0c4-0000-7000-8000-0000000000ab';
const PUBLIC_ID = 'LPR-2026-004242';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const OTHER_DEVICE: DeviceIdentity = {
  hash: 'c'.repeat(64),
  dayHash: 'd'.repeat(64),
  isNew: false,
};

const CONTEXT: IdempotencyContext = { requestId: 'req-1', deviceHash: DEVICE.hash };

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: REPORT_ID,
    publicId: PUBLIC_ID,
    category: 'stop_facility',
    status: 'submitted',
    moderation: 'pending',
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    authorityName: 'Dinhub Banyumas',
    evidenceScore: 0.4,
    evidenceLevel: 'none',
    corroborationCount: 0,
    text: 'Atap halte bocor sejak hujan kemarin malam',
    createdAt: new Date('2026-10-26T10:00:00.000Z'),
    resolvedAt: null,
    followUpAt: null,
    deviceHash: DEVICE.hash,
    ...overrides,
  };
}

interface CallLog {
  scopes: string[];
  inserted: InsertReportValues[];
  events: { kind: string; payload: Record<string, unknown> }[];
}

interface Overrides {
  uploads?: Partial<Pick<UploadsService, 'claimForReport'>>;

  stop?: { id: string; code: string; name: string; status: 'active' | 'inactive'; cityId: string } | null;
  lockedStatus?: ReportRow['status'];
  lockedDevice?: string;
  participation?: { reporter: boolean; corroborator: boolean };
  corroborationOutcome?: { inserted: boolean; count: number };
  owned?: ReportRow | null;
  hadContact?: boolean;
}

function repositoryDouble(log: CallLog, overrides: Overrides): ReportsRepository {
  return {
    findStopByCode: async () =>
      overrides.stop === undefined
        ? { id: STOP_ID, code: 'BMS-A12', name: 'Halte UMP', status: 'active', cityId: 'c1' }
        : overrides.stop,
    findAuthorityForStop: async () => null,
    findSessionVerdict: async () => 'already_planned',
    insertReport: async (_tx: unknown, values: InsertReportValues) => {
      log.inserted.push(values);
      return row({ publicId: values.publicId, category: values.category, text: values.text });
    },
    appendEvent: async (
      _tx: unknown,
      _reportId: string,
      values: { kind: string; payload: Record<string, unknown> },
    ) => {
      log.events.push({ kind: values.kind, payload: values.payload });
      return log.events.length;
    },
    listEvents: async () => [],
    listEventsVia: async () => [],
    addCorroboration: async () =>
      overrides.corroborationOutcome ?? { inserted: true, count: 1 },
    readCorroborationCount: async () => 0,
    lockReport: async () => ({
      status: overrides.lockedStatus ?? 'submitted',
      deviceHash: overrides.lockedDevice ?? OTHER_DEVICE.hash,
    }),
    findParticipation: async () =>
      overrides.participation ?? { reporter: true, corroborator: false },
    recordClosure: async () => undefined,
    findReportIdByPublicId: async () => REPORT_ID,
    findByPublicIdForDevice: async () => row(),
    findOwnedByPublicId: async () => (overrides.owned === undefined ? row() : overrides.owned),
    findByPublicId: async () => row(),
    clearContact: async () => ({ hadContact: overrides.hadContact ?? false }),
    contactCiphertext: async () => null,
    findPublicByPublicId: async () => row({ moderation: 'approved', status: 'submitted' }),
    listPublic: async () => ({ items: [row()], hasMore: false }),
    listForDevice: async () => ({ items: [row()], hasMore: false }),
    countRecentByDevice: async () => 0,
  } as unknown as ReportsRepository;
}

function transactionDouble(sequence: string): { execute: () => Promise<{ rows: unknown[] }> } {
  return { execute: async () => ({ rows: [{ value: sequence }] }) };
}

function buildService(overrides: Overrides = {}): {
  service: ReportsService;
  log: CallLog;
} {
  const log: CallLog = { scopes: [], inserted: [], events: [] };
  const idempotency = {
    execute: async (
      input: { scope: string },
      work: (tx: unknown) => Promise<{ status: number; body: unknown }>,
    ) => {
      log.scopes.push(input.scope);
      const result = await work(transactionDouble('4242'));
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  const devices = {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: null }),
  } as unknown as DevicesRepository;
  const uploads = {
    claimForReport: async () => undefined,
    ...(overrides.uploads ?? {}),
  } as unknown as UploadsService;
  return {
    service: new ReportsService(
      repositoryDouble(log, overrides),
      devices,
      idempotency,
      auditStub(),
      passthroughRunner,
      uploads,
    ),
    log,
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    category: 'stop_facility' as const,
    stopCode: 'BMS-A12',
    text: 'Atap halte bocor sejak hujan kemarin malam',
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
    ...overrides,
  };
}

const KEY = '0192f0c4-0000-7000-8000-000000000002';

describe('text sanitisation', () => {
  it('strips control characters that could break rendering', () => {
    expect(sanitizeText('halte\u0000bocor\u0007 parah')).toBe('haltebocor parah');
  });

  it('collapses runs of whitespace and drops empty lines', () => {
    expect(sanitizeText('  atap   bocor \n\n\n  sejak kemarin  ')).toBe(
      'atap bocor\nsejak kemarin',
    );
  });

  it('rejects text that becomes too short after cleaning', () => {
    expect(() => assertUsableText('\n\n\u0000\u0000           \n')).toThrow();
  });

  it('accepts text that is long enough after cleaning', () => {
    expect(assertUsableText('  Atap halte bocor sejak kemarin malam  ')).toBe(
      'Atap halte bocor sejak hujan kemarin malam'.replace('hujan ', ''),
    );
  });

  it('returns null for an empty note', () => {
    expect(sanitizeNote('   ')).toBeNull();
    expect(sanitizeNote(undefined)).toBeNull();
  });

  it('truncates notes to the documented limit', () => {
    expect(sanitizeNote('a'.repeat(400))?.length).toBe(280);
  });
});

describe('closure status mapping', () => {
  const now = new Date('2026-10-26T10:00:00.000Z');

  it('verifies only on a yes answer', () => {
    expect(statusAfterClosure('yes', now)).toEqual({
      status: 'verified_resolved',
      resolvedAt: now,
    });
  });

  it('marks disputed for no and partial answers', () => {
    expect(statusAfterClosure('no', now)).toEqual({
      status: 'disputed',
      resolvedAt: null,
    });
    expect(statusAfterClosure('partial', now)).toEqual({
      status: 'disputed',
      resolvedAt: null,
    });
  });
});

describe('ReportsService.create', () => {
  it('scopes idempotency per device and records a submitted event', async () => {
    const { service, log } = buildService();

    const result = await service.create(createInput(), KEY, DEVICE, CONTEXT);

    expect(log.scopes).toEqual([`report.create.${DEVICE.hash}`]);
    expect(log.events.map((event) => event.kind)).toEqual(['submitted']);
    expect(result.report.publicId).toMatch(/^LPR-\d{4}-\d{6}$/);
  });

  it('stores the contact email only as ciphertext and a keyed hash', async () => {
    const { service, log } = buildService();

    await service.create(createInput({ contactEmail: 'warga@example.com' }), KEY, DEVICE, CONTEXT);

    const stored = log.inserted[0] as { contactEmailEnc?: Buffer | null; contactEmailHash?: Buffer | null };
    expect(Buffer.isBuffer(stored.contactEmailEnc)).toBe(true);
    expect(Buffer.isBuffer(stored.contactEmailHash)).toBe(true);
    expect(stored.contactEmailEnc?.toString('utf8') ?? '').not.toContain('warga');
    expect(stored.contactEmailHash).toHaveLength(32);
    expect(JSON.stringify(log.inserted)).not.toContain('warga@example.com');
  });

  it('rejects a malformed contact email instead of silently dropping it', async () => {
    const { service, log } = buildService();

    await expect(
      service.create(createInput({ contactEmail: 'bukan-email' }), KEY, DEVICE, CONTEXT),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(log.inserted).toHaveLength(0);
  });

  it('claims a photo inside the same transaction as the report', async () => {
    const claimed: { uploadId: string; reportId: string; deviceHash: string }[] = [];
    const { service, log } = buildService({
      uploads: {
        claimForReport: async (_tx, uploadId, reportId, deviceHash) => {
          claimed.push({ uploadId, reportId, deviceHash });
        },
      },
    });

    const uploadId = '0192f0c4-0000-7000-8000-0000000000cc';
    const result = await service.create(createInput({ photoUploadId: uploadId }), KEY, DEVICE, CONTEXT);

    expect(claimed).toEqual([{ uploadId, reportId: expect.any(String), deviceHash: DEVICE.hash }]);
    expect(result.warnings).toContain('photo_pending_review');
    expect(log.inserted[0]).not.toHaveProperty('photoUploadId');
  });

  it('never puts the narrative text into the audit event', async () => {
    const { service, log } = buildService();

    await service.create(createInput(), KEY, DEVICE, CONTEXT);

    expect(JSON.stringify(log.events)).not.toContain('Atap halte bocor');
    expect(log.events[0]?.payload).toHaveProperty('textLength');
  });

  it('rejects an unknown stop', async () => {
    const { service } = buildService({ stop: null });

    await expect(
      service.create(createInput(), KEY, DEVICE, CONTEXT),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an inactive stop', async () => {
    const { service } = buildService({
      stop: { id: STOP_ID, code: 'BMS-A12', name: 'Halte UMP', status: 'inactive', cityId: 'c1' },
    });

    await expect(
      service.create(createInput(), KEY, DEVICE, CONTEXT),
    ).rejects.toMatchObject({ code: 'STOP_INACTIVE' });
  });

  it('rejects devices that never completed bootstrap', async () => {
    const { service } = buildService();

    await expect(
      service.create(createInput(), KEY, { ...DEVICE, isNew: true }, CONTEXT),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('raises the evidence score when triage found a plan', async () => {
    const { service, log } = buildService();

    await service.create(
      createInput({ triageSessionId: '0192f0c4-0000-7000-8000-0000000000dd' }),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(log.inserted[0]?.evidenceScore).toBeGreaterThan(0.35);
  });
});

describe('ReportsService.listPublic', () => {
  it('rejects filters that would expose non-public statuses', async () => {
    const { service } = buildService();

    await expect(
      service.listPublic({ limit: 20, status: 'rejected' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts the statuses that are visible to the public', async () => {
    const { service } = buildService();

    const result = await service.listPublic({ limit: 20, status: 'acknowledged' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('text');
  });
});

describe('ReportsService.corroborate', () => {
  it('rejects support on your own report', async () => {
    const { service } = buildService({ lockedDevice: DEVICE.hash });

    await expect(
      service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects support on a closed report', async () => {
    const { service } = buildService({ lockedStatus: 'closed' });

    await expect(
      service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('reports an already counted device without writing another event', async () => {
    const { service, log } = buildService({
      corroborationOutcome: { inserted: false, count: 3 },
    });

    const result = await service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT);

    expect(result).toEqual({ corroborationCount: 3, alreadyCounted: true });
    expect(log.events).toHaveLength(0);
  });

  it('records a citizen support event exactly once', async () => {
    const { service, log } = buildService();

    const result = await service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT);

    expect(result.alreadyCounted).toBe(false);
    expect(log.events[0]?.kind).toBe('corrected');
  });
});

describe('ReportsService.verifyClosure', () => {
  it('requires a partner claim before citizens can verify', async () => {
    const { service } = buildService({ lockedStatus: 'acknowledged' });

    await expect(
      service.verifyClosure(
        PUBLIC_ID,
        { answer: 'yes', clientEventId: '0192f0c4-0000-7000-8000-000000000003' },
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects devices that never interacted with the report', async () => {
    const { service } = buildService({
      lockedStatus: 'claimed_resolved',
      participation: { reporter: false, corroborator: false },
    });

    await expect(
      service.verifyClosure(
        PUBLIC_ID,
        { answer: 'yes', clientEventId: '0192f0c4-0000-7000-8000-000000000004' },
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('verifies a closure for the reporter', async () => {
    const { service, log } = buildService({
      lockedStatus: 'claimed_resolved',
      participation: { reporter: true, corroborator: false },
    });

    const result = await service.verifyClosure(
      PUBLIC_ID,
      { answer: 'yes', clientEventId: '0192f0c4-0000-7000-8000-000000000005' },
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(result).toEqual({ status: 'verified_resolved', recorded: true });
    expect(log.events[0]?.kind).toBe('verified_resolved');
  });
});

describe('ReportsService.mineDetail', () => {
  it('returns the owner detail with event history', async () => {
    const { service } = buildService();

    const detail: ReportDetail = await service.mineDetail(PUBLIC_ID, DEVICE);

    expect(detail.publicId).toBe(PUBLIC_ID);
    expect(detail).toHaveProperty('text');
  });
});
