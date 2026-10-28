import { createHash } from 'node:crypto';
import type { ObjectStorage } from '../../common/storage/object-storage';
import type { UploadRow, UploadsRepository } from '../../db/repositories/uploads.repository';
import { auditStub } from '../../test-support/audit.stub';
import { UploadsService } from './uploads.service';

const DEVICE_HASH = 'a'.repeat(64);
const OTHER_DEVICE = 'b'.repeat(64);
const CONTEXT = { requestId: 'req-1', deviceHash: DEVICE_HASH };
const TOKEN = 'x'.repeat(43);

interface Store {
  row: UploadRow | null;
  stored: unknown[];
  rejected: string[];
  attached: string[];
  media: unknown[];
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function uploadRow(overrides: Partial<UploadRow> = {}): UploadRow {
  return {
    id: '0192f0c4-0000-7000-8000-0000000000dd',
    deviceHash: DEVICE_HASH,
    tokenHash: hash(TOKEN),
    purpose: 'report_photo',
    declaredMime: 'image/png',
    declaredSize: 1_000,
    actualMime: null,
    actualSize: null,
    width: null,
    height: null,
    sha256: null,
    objectKey: null,
    status: 'pending',
    hasExif: false,
    reportId: null,
    expiresAt: new Date(Date.now() + 600_000),
    ...overrides,
  };
}

function png(width = 320, height = 240): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function build(store: Store) {
  const repository = {
    findById: async (_tx: unknown, id: string) =>
      store.row === null || store.row.id !== id ? null : store.row,
    markStored: async (input: unknown) => {
      store.stored.push(input);
      return true;
    },
    markRejected: async (_id: string, code: string) => {
      store.rejected.push(code);
      return undefined;
    },
    attachToReport: async (_tx: unknown, id: string) => {
      store.attached.push(id);
      return true;
    },
    insertReportMedia: async (_tx: unknown, values: unknown) => {
      store.media.push(values);
      return undefined;
    },
  } as unknown as UploadsRepository;
  const storage = {
    put: async () => undefined,
    get: async () => null,
    remove: async () => undefined,
  } as unknown as ObjectStorage;
  return new UploadsService(repository, auditStub(), storage, {} as never);
}

function newStore(row: UploadRow | null = uploadRow()): Store {
  return { row, stored: [], rejected: [], attached: [], media: [] };
}

describe('UploadsService.store', () => {
  it('stores a valid PNG with verified facts', async () => {
    const store = newStore();
    const result = await build(store).store(
      uploadRow().id,
      TOKEN,
      'image/png',
      png(320, 240),
      CONTEXT,
    );

    expect(result.mime).toBe('image/png');
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(store.stored).toHaveLength(1);
  });

  it('rejects a token that does not belong to the upload', async () => {
    const store = newStore();

    await expect(
      build(store).store(uploadRow().id, 'y'.repeat(43), 'image/png', png(), CONTEXT),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(store.stored).toHaveLength(0);
  });

  it('rejects a malformed token without touching the repository', async () => {
    const store = newStore();

    await expect(
      build(store).store(uploadRow().id, 'short', 'image/png', png(), CONTEXT),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses another device upload as not found', async () => {
    const store = newStore();

    await expect(
      build(store).store(uploadRow().id, TOKEN, 'image/png', png(), {
        requestId: 'req-1',
        deviceHash: OTHER_DEVICE,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to reuse a stored upload', async () => {
    const store = newStore(uploadRow({ status: 'stored', objectKey: 'uploads/ab/x.png' }));

    await expect(
      build(store).store(uploadRow().id, TOKEN, 'image/png', png(), CONTEXT),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses an expired upload session', async () => {
    const store = newStore(uploadRow({ expiresAt: new Date(Date.now() - 1_000) }));

    await expect(
      build(store).store(uploadRow().id, TOKEN, 'image/png', png(), CONTEXT),
    ).rejects.toMatchObject({ code: 'QR_EXPIRED' });
  });

  it('rejects content that is not an allowed image and records the reason', async () => {
    const store = newStore();
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(64)}</svg>`);

    await expect(build(store).store(uploadRow().id, TOKEN, 'image/png', svg, CONTEXT)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    expect(store.rejected.length).toBe(1);
    expect(store.stored).toHaveLength(0);
  });

  it('rejects a Content-Type that disagrees with the bytes', async () => {
    const store = newStore();

    await expect(
      build(store).store(uploadRow().id, TOKEN, 'image/jpeg', png(), CONTEXT),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(store.rejected).toContain('mime_mismatch');
  });

  it('rejects a decompression bomb before storing', async () => {
    const store = newStore();

    await expect(
      build(store).store(uploadRow().id, TOKEN, 'image/png', png(9000, 9000), CONTEXT),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(store.stored).toHaveLength(0);
  });
});

describe('UploadsService.claimForReport', () => {
  const stored = (): UploadRow =>
    uploadRow({
      status: 'stored',
      objectKey: 'uploads/ab/deadbeef.png',
      actualMime: 'image/png',
      actualSize: 33,
      width: 320,
      height: 240,
      sha256: Buffer.alloc(32, 3),
    });

  it('attaches a stored upload to the report', async () => {
    const store = newStore(stored());

    await build(store).claimForReport({} as never, stored().id, 'report-1', DEVICE_HASH);

    expect(store.attached).toEqual([stored().id]);
    expect(store.media).toHaveLength(1);
  });

  it('refuses an upload owned by another device', async () => {
    const store = newStore(stored());

    await expect(
      build(store).claimForReport({} as never, stored().id, 'report-1', OTHER_DEVICE),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.attached).toHaveLength(0);
  });

  it('refuses an upload that was never completed', async () => {
    const store = newStore(uploadRow({ status: 'pending' }));

    await expect(
      build(store).claimForReport({} as never, uploadRow().id, 'report-1', DEVICE_HASH),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an upload that was already attached', async () => {
    const store = newStore(uploadRow({ status: 'attached', objectKey: 'uploads/ab/x.png' }));

    await expect(
      build(store).claimForReport({} as never, uploadRow().id, 'report-1', DEVICE_HASH),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
