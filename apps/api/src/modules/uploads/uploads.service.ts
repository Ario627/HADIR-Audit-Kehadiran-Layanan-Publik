import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UploadRequest, UploadTicket } from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { ALLOWED_IMAGE_MIMES, ImageRejected, sniffImage, type ImageMime } from '../../common/media/image-sniff';
import { OBJECT_STORAGE, objectKeyFor, type ObjectStorage } from '../../common/storage/object-storage';
import type { Database, Transaction } from '../../db/client';
import { DATABASE } from '../../db/db.module';
import { UploadsRepository } from '../../db/repositories/uploads.repository';

const UPLOAD_TTL_MS = 15 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const EXTENSION: Readonly<Record<ImageMime, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export interface UploadContext {
  requestId: string;
  deviceHash: string;
}

export interface StoredUpload {
  uploadId: string;
  mime: ImageMime;
  width: number;
  height: number;
  sha256: Buffer;
  objectKey: string;
  hasExif: boolean;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function tokenMatches(provided: string, expected: Buffer): boolean {
  if (expected.length !== 32) {
    return false;
  }
  return timingSafeEqual(hashToken(provided), expected);
}

function mimeFromDeclared(value: string): ImageMime {
  if (!ALLOWED_IMAGE_MIMES.includes(value as ImageMime)) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
      detail: 'Hanya JPEG, PNG, atau WebP yang diterima.',
    });
  }
  return value as ImageMime;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly repository: UploadsRepository,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async createTicket(input: UploadRequest, context: UploadContext): Promise<UploadTicket> {
    const declaredMime = mimeFromDeclared(input.contentType);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);

    const uploadId = await this.repository.create({
      deviceHash: context.deviceHash,
      tokenHash: hashToken(token),
      purpose: input.purpose,
      declaredMime,
      declaredSize: input.size,
      expiresAt,
    });

    return {
      uploadId,
      url: `/v1/uploads/${uploadId}`,
      method: 'PUT',
      headers: { 'Content-Type': declaredMime, 'X-Upload-Token': token },
      expiresAt: expiresAt.toISOString(),
    };
  }

  async store(
    uploadId: string,
    token: string | null,
    declaredContentType: string | undefined,
    bytes: Buffer,
    context: UploadContext,
  ): Promise<StoredUpload> {
    if (token === null || !TOKEN_PATTERN.test(token)) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Token unggah tidak valid.' });
    }
    const upload = await this.repository.findById(this.db, uploadId);
    if (upload === null || upload.deviceHash !== context.deviceHash) {
      throw new AppError('NOT_FOUND', { detail: 'Unggahan tidak ditemukan.' });
    }
    if (upload.status !== 'pending') {
      throw new AppError('INVALID_TRANSITION', { detail: 'Unggahan ini sudah dipakai.' });
    }
    if (!tokenMatches(token, upload.tokenHash)) {
      await this.audit.record({
        action: 'upload.rejected',
        objectType: 'system',
        objectId: uploadId,
        actor: { kind: 'citizen', deviceHash: context.deviceHash },
        requestId: context.requestId,
        payload: { code: 'token_mismatch' },
      });
      throw new AppError('UNAUTHENTICATED', { detail: 'Token unggah tidak valid.' });
    }
    if (upload.expiresAt.getTime() <= Date.now()) {
      throw new AppError('QR_EXPIRED', { detail: 'Sesi unggah sudah kedaluwarsa.' });
    }

    let facts;
    try {
      facts = sniffImage(bytes);
    } catch (error) {
      const code = error instanceof ImageRejected ? error.code : 'invalid';
      await this.repository.markRejected(uploadId, code);
      await this.audit.record({
        action: 'upload.rejected',
        objectType: 'system',
        objectId: uploadId,
        actor: { kind: 'citizen', deviceHash: context.deviceHash },
        requestId: context.requestId,
        payload: { code, declaredMime: upload.declaredMime, bytes: bytes.length },
      });
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        detail: error instanceof ImageRejected ? error.message : 'Berkas tidak dapat diverifikasi.',
      });
    }

    if (declaredContentType !== undefined && declaredContentType !== facts.mime) {
      await this.repository.markRejected(uploadId, 'mime_mismatch');
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        detail: 'Content-Type tidak cocok dengan isi berkas.',
      });
    }

    const objectKey = objectKeyFor('uploads', bytes, EXTENSION[facts.mime]);
    const sha256 = createHash('sha256').update(bytes).digest();
    await this.storage.put({ key: objectKey, bytes });
    const stored = await this.repository.markStored({
      id: uploadId,
      actualMime: facts.mime,
      actualSize: bytes.length,
      width: facts.width,
      height: facts.height,
      sha256,
      objectKey,
      hasExif: facts.hasExif,
    });
    if (!stored) {
      throw new AppError('INVALID_TRANSITION', { detail: 'Unggahan ini sudah dipakai.' });
    }

    await this.audit.record({
      action: 'upload.stored',
      objectType: 'system',
      objectId: uploadId,
      actor: { kind: 'citizen', deviceHash: context.deviceHash },
      requestId: context.requestId,
      payload: { mime: facts.mime, bytes: bytes.length, hasExif: facts.hasExif },
    });

    return {
      uploadId,
      mime: facts.mime,
      width: facts.width,
      height: facts.height,
      sha256,
      objectKey,
      hasExif: facts.hasExif,
    };
  }

  async claimForReport(
    tx: Transaction,
    uploadId: string,
    reportId: string,
    reportOwnerHash: string,
  ): Promise<void> {
    const upload = await this.repository.findById(tx, uploadId);
    if (upload === null || upload.deviceHash !== reportOwnerHash) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Unggahan bukan milik perangkat ini.',
        errors: [{ field: 'photoUploadId', code: 'not_owned', message: 'Unggahan bukan milik perangkat ini.' }],
      });
    }
    if (upload.status !== 'stored') {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Unggahan belum selesai atau sudah dipakai.',
        errors: [{ field: 'photoUploadId', code: 'not_stored', message: 'Unggahan belum selesai.' }],
      });
    }
    if (upload.objectKey === null || upload.sha256 === null) {
      throw new AppError('VALIDATION_FAILED', { detail: 'Unggahan tidak lengkap.' });
    }

    const attached = await this.repository.attachToReport(tx, uploadId, reportId);
    if (!attached) {
      throw new AppError('INVALID_TRANSITION', { detail: 'Unggahan ini sudah dipakai.' });
    }
    await this.repository.insertReportMedia(tx, {
      reportId,
      objectKey: upload.objectKey,
      mime: upload.actualMime ?? upload.declaredMime,
      width: upload.width ?? 1,
      height: upload.height ?? 1,
      sha256: upload.sha256,
    });
  }
}
