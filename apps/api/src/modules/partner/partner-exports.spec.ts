import type { ExportReportRow } from '../../db/repositories/export.repository';
import {
  downloadPath,
  signDownload,
  toCsv,
  toExportDetail,
  toExportTicket,
  toOpen311,
  verifyDownloadSignature,
} from './partner-exports.service';

function row(overrides: Partial<ExportReportRow> = {}): ExportReportRow {
  return {
    publicId: 'LPR-2026-000001',
    category: 'service_wait',
    status: 'acknowledged',
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    createdAt: new Date('2026-10-01T01:00:00.000Z'),
    resolvedAt: null,
    corroborationCount: 2,
    evidenceScore: 0.55,
    evidenceLevel: 'indication',
    text: 'Bus tidak berhenti selama tiga kali lewat',
    ...overrides,
  };
}

describe('toCsv', () => {
  it('writes a header plus one line per row', () => {
    const csv = toCsv([row(), row({ publicId: 'LPR-2026-000002' })]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('public_id,category,status');
    expect(lines[1]).toContain('LPR-2026-000001');
    expect(lines[2]).toContain('LPR-2026-000002');
  });

  it('quotes cells containing separators, quotes and newlines', () => {
    const csv = toCsv([row({ text: 'baris satu, "kutip"\nbaris dua' })]);
    expect(csv).toContain('"baris satu, ""kutip"" baris dua"');
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('emits a header only for an empty selection', () => {
    expect(toCsv([]).trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('writes null resolution as an empty cell', () => {
    const csv = toCsv([row()]);
    const cells = csv.split('\r\n')[1]!.split(',');
    expect(cells[6]).toBe('');
  });

  it('formats evidence score with two decimals', () => {
    expect(toCsv([row({ evidenceScore: 0.5 })])).toContain(',0.50,');
  });
});

describe('toOpen311', () => {
  it('produces a JSON array with the documented keys', () => {
    const parsed = JSON.parse(toOpen311([row()])) as Record<string, string>[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.service_request_id).toBe('LPR-2026-000001');
    expect(parsed[0]?.address_string).toBe('BMS-A12 Halte UMP');
    expect(parsed[0]?.requested_datetime).toBe('2026-10-01T01:00:00.000Z');
  });

  it('falls back to the creation time when unresolved', () => {
    const parsed = JSON.parse(toOpen311([row()])) as Record<string, string>[];
    expect(parsed[0]?.updated_datetime).toBe('2026-10-01T01:00:00.000Z');
  });

  it('collapses newlines in the description', () => {
    const parsed = JSON.parse(toOpen311([row({ text: 'a\nb' })])) as Record<string, string>[];
    expect(parsed[0]?.description).toBe('a b');
  });
});

describe('download signatures', () => {
  const secret = 'test-secret-value';
  const exportId = '0192f0c4-0000-7000-8000-0000000000e1';
  const institutionId = '0192f0c4-0000-7000-8000-0000000000a1';
  const now = 1_700_000_000_000;

  it('accepts a freshly signed URL', () => {
    const expiresAtMs = now + 60_000;
    const signature = signDownload(secret, exportId, institutionId, expiresAtMs);
    expect(
      verifyDownloadSignature({
        secret,
        exportId,
        institutionId,
        expiresAtMs,
        signature,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('rejects an expired URL', () => {
    const expiresAtMs = now - 1;
    const signature = signDownload(secret, exportId, institutionId, expiresAtMs);
    expect(
      verifyDownloadSignature({
        secret,
        exportId,
        institutionId,
        expiresAtMs,
        signature,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature bound to another export', () => {
    const expiresAtMs = now + 60_000;
    const signature = signDownload(secret, exportId, institutionId, expiresAtMs);
    expect(
      verifyDownloadSignature({
        secret,
        exportId: '0192f0c4-0000-7000-8000-0000000000e2',
        institutionId,
        expiresAtMs,
        signature,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature bound to another institution', () => {
    const expiresAtMs = now + 60_000;
    const signature = signDownload(secret, exportId, institutionId, expiresAtMs);
    expect(
      verifyDownloadSignature({
        secret,
        exportId,
        institutionId: '0192f0c4-0000-7000-8000-0000000000a2',
        expiresAtMs,
        signature,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature with a different secret', () => {
    const expiresAtMs = now + 60_000;
    const signature = signDownload('other-secret', exportId, institutionId, expiresAtMs);
    expect(
      verifyDownloadSignature({
        secret,
        exportId,
        institutionId,
        expiresAtMs,
        signature,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    expect(
      verifyDownloadSignature({
        secret,
        exportId,
        institutionId,
        expiresAtMs: now + 60_000,
        signature: 'x',
        nowMs: now,
      }),
    ).toBe(false);
  });

  it('builds a relative download path', () => {
    expect(downloadPath(exportId, 123, 'sig')).toBe(
      `/v1/partner/exports/${exportId}/download?exp=123&sig=sig`,
    );
  });
});

describe('export projections', () => {
  const record = {
    id: '0192f0c4-0000-7000-8000-0000000000e1',
    institutionId: '0192f0c4-0000-7000-8000-0000000000a1',
    requestedBy: '0192f0c4-0000-7000-8000-0000000000b1',
    format: 'csv',
    scope: {},
    status: 'ready',
    objectKey: `exports/ab/${'a'.repeat(64)}.csv`,
    rowCount: 12,
    byteSize: 900,
    errorCode: null,
    createdAt: new Date('2026-10-20T10:00:00.000Z'),
    completedAt: new Date('2026-10-20T10:00:01.000Z'),
    expiresAt: new Date('2026-10-21T10:00:00.000Z'),
  };

  it('maps a ticket', () => {
    expect(toExportTicket(record)).toEqual({
      exportId: record.id,
      status: 'ready',
      format: 'csv',
      createdAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('exposes a signed download URL while the export is live', () => {
    const detail = toExportDetail(record, new Date('2026-10-20T12:00:00.000Z'));
    expect(detail.status).toBe('ready');
    expect(detail.downloadUrl).toContain(`/v1/partner/exports/${record.id}/download?`);
    expect(detail.downloadUrl).toContain('sig=');
  });

  it('reports expired and hides the URL once the retention window passed', () => {
    const detail = toExportDetail(record, new Date('2026-10-22T12:00:00.000Z'));
    expect(detail.status).toBe('expired');
    expect(detail.downloadUrl).toBeNull();
  });

  it('never exposes a URL for a failed export', () => {
    const detail = toExportDetail(
      { ...record, status: 'failed', objectKey: null, expiresAt: null },
      new Date('2026-10-20T12:00:00.000Z'),
    );
    expect(detail.status).toBe('failed');
    expect(detail.downloadUrl).toBeNull();
  });
});
