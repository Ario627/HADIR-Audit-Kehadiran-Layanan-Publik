import type { Transaction } from '../../db/client';
import type { TransactionRunner } from '../../db/transaction-runner';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { AdminRepository } from '../../db/repositories/admin.repository';
import type { ReportsRepository } from '../../db/repositories/reports.repository';
import { auditStub } from '../../test-support/audit.stub';
import { AdminService } from './admin.service';
import type { TransparencyService } from '../transparency/transparency.service';

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

function buildService(writes: unknown[] = []): AdminService {
  const repository = {
    upsertRup: async (_tx: unknown, values: unknown) => {
      writes.push(values);
      return { inserted: true };
    },
    listRup: async () => ({ items: [], hasMore: false }),
  } as unknown as AdminRepository;
  const transparency = {} as unknown as TransparencyService;
  return new AdminService(
    repository,
    {} as never,
    auditStub(),
    transparency,
    passthroughRunner,
  );
}

describe('AdminService.importRup', () => {
  it('rejects a CSV without the required headers', async () => {
    await expect(
      buildService().importRup(
        { csv: 'a,b\n1,2', sourceUrl: 'https://example.test/rup', fiscalYear: 2026, dryRun: false },
        SESSION,
        'req-1',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects malformed CSV quoting', async () => {
    await expect(
      buildService().importRup(
        {
          csv: 'satker,nama_paket\n"unterminated,2',
          sourceUrl: 'https://example.test/rup',
          fiscalYear: 2026,
          dryRun: false,
        },
        SESSION,
        'req-2',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('dry run counts rows without writing anything', async () => {
    const writes: unknown[] = [];
    const result = await buildService(writes).importRup(
      {
        csv: 'satker,nama_paket,lokasi\nDinhub,Perbaikan Halte,Purwokerto\nDinhub,,Kosong',
        sourceUrl: 'https://example.test/rup',
        fiscalYear: 2026,
        dryRun: true,
      },
      SESSION,
      'req-3',
    );
    expect(result.dryRun).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });

  it('imports with the CLI year as a fallback and reports insert counts', async () => {
    const writes: { fiscalYear: number; matchKeywords: string[]; pagu: string | null }[] = [];
    const result = await buildService(writes).importRup(
      {
        csv: 'satker,nama_paket,pagu,kata_kunci\nDinhub,Perbaikan Halte,"1.500.000","halte;bus"',
        sourceUrl: 'https://example.test/rup',
        fiscalYear: 2026,
        dryRun: false,
      },
      SESSION,
      'req-4',
    );
    expect(result.inserted).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(writes[0]).toMatchObject({
      fiscalYear: 2026,
      matchKeywords: ['halte', 'bus'],
      pagu: '1500000.00',
    });
  });

  it('skips a row with an out of range fiscal year', async () => {
    const writes: unknown[] = [];
    const result = await buildService(writes).importRup(
      {
        csv: 'satker,nama_paket,tahun\nDinhub,Perbaikan Halte,1999',
        sourceUrl: 'https://example.test/rup',
        fiscalYear: 2026,
        dryRun: false,
      },
      SESSION,
      'req-5',
    );
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('rejects more than five thousand rows', async () => {
    const header = 'satker,nama_paket\n';
    const body = Array.from({ length: 5_001 }, (_v, index) => `Dinhub,Paket ${index}`).join('\n');
    await expect(
      buildService().importRup(
        { csv: `${header}${body}`, sourceUrl: 'https://example.test/rup', fiscalYear: 2026, dryRun: true },
        SESSION,
        'req-6',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('AdminService moderation queue', () => {
  function buildQueue(rows: unknown[]): AdminService {
    const reports = {
      listForModeration: async (_tx: unknown, filters: { moderation: string }) => {
        expect(filters.moderation).toBe('pending');
        return { items: rows, hasMore: false };
      },
    } as unknown as ReportsRepository;
    return new AdminService(
      {} as unknown as AdminRepository,
      reports,
      auditStub(),
      {} as unknown as TransparencyService,
      passthroughRunner,
    );
  }

  const row = {
    publicId: 'LPR-2026-000123',
    category: 'service_wait',
    status: 'submitted',
    moderation: 'pending',
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    authorityName: 'Dishub Banyumas',
    text: 'Bus tidak datang selama dua puluh menit.',
    evidenceScore: 0.4,
    evidenceLevel: 'indication',
    corroborationCount: 2,
    createdAt: new Date('2026-11-10T03:00:00.000Z'),
    resolvedAt: null,
    followUpAt: null,
    deviceHash: 'a'.repeat(64),
    id: '0192f0c4-0000-7000-8000-0000000000a1',
  };

  it('maps rows and drops reports without a stop', async () => {
    const service = buildQueue([row, { ...row, publicId: 'LPR-2026-000124', stopCode: null }]);
    const result = await service.moderationQueue({ moderation: 'pending', limit: 20 });
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      publicId: 'LPR-2026-000123',
      stopCode: 'BMS-A12',
      institutionName: 'Dishub Banyumas',
    });
  });

  it('does not leak the device hash into the queue', async () => {
    const service = buildQueue([row]);
    const result = await service.moderationQueue({ moderation: 'pending', limit: 20 });
    expect(JSON.stringify(result)).not.toContain('a'.repeat(64));
  });

  it('rejects an unknown report on detail', async () => {
    const reports = {
      findByPublicId: async () => null,
    } as unknown as ReportsRepository;
    const service = new AdminService(
      {} as unknown as AdminRepository,
      reports,
      auditStub(),
      {} as unknown as TransparencyService,
      passthroughRunner,
    );
    await expect(service.reportDetail('LPR-2026-000404')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns the detail with score and follow-up date', async () => {
    const reports = {
      findByPublicId: async () => row,
    } as unknown as ReportsRepository;
    const service = new AdminService(
      {} as unknown as AdminRepository,
      reports,
      auditStub(),
      {} as unknown as TransparencyService,
      passthroughRunner,
    );
    const detail = await service.reportDetail('LPR-2026-000123');
    expect(detail.evidenceScore).toBe(0.4);
    expect(detail.followUpAt).toBeNull();
    expect(detail.createdAt).toBe('2026-11-10T03:00:00.000Z');
  });

  it('lists cities through the admin scope', async () => {
    const repository = {
      listCities: async () => [
        { id: '0192f0c4-0000-7000-8000-0000000000b1', code: 'BMS', name: 'Banyumas', timezone: 'Asia/Jakarta' },
      ],
    } as unknown as AdminRepository;
    const service = new AdminService(
      repository,
      {} as unknown as ReportsRepository,
      auditStub(),
      {} as unknown as TransparencyService,
      passthroughRunner,
    );
    const result = await service.cities();
    expect(result.count).toBe(1);
    expect(result.items[0]?.code).toBe('BMS');
  });
});
