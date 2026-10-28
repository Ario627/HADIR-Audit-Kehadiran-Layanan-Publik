import { Inject, Injectable } from '@nestjs/common';
import type { ReportMediaItem } from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/http/request-context';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { ReportsRepository } from '../../db/repositories/reports.repository';

export interface MediaObject {
  bytes: Buffer;
  mime: string;
  publicId: string;
}

export interface MediaViewer {
  actor: Actor | null;
}

export function mediaVisibleTo(status: string, actor: Actor | null): boolean {
  if (status === 'approved') {
    return true;
  }
  if (status === 'rejected') {
    return false;
  }
  if (actor === null) {
    return false;
  }
  return (
    actor.kind === 'citizen' ||
    actor.kind === 'partner' ||
    actor.kind === 'moderator' ||
    actor.kind === 'superadmin'
  );
}

export function toMediaItems(
  publicId: string,
  rows: readonly { id: string; mime: string; width: number | null; height: number | null; status: string }[],
): ReportMediaItem[] {
  return rows
    .filter((row) => row.status === 'approved')
    .map((row) => ({
      mediaId: row.id,
      mime: row.mime as ReportMediaItem['mime'],
      width: row.width ?? 1,
      height: row.height ?? 1,
      url: `/v1/reports/${publicId}/media/${row.id}`,
    }));
}

@Injectable()
export class ReportsMediaService {
  constructor(
    private readonly repository: ReportsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private contextFor(actor: Actor | null): {
    deviceHash?: string;
    userId?: string;
    institutionId?: string;
    scope: 'public' | 'citizen' | 'partner' | 'admin';
    requestId: string;
  } {
    if (actor === null) {
      return { scope: 'public', requestId: 'media-public' };
    }
    if (actor.kind === 'citizen') {
      return { scope: 'citizen', deviceHash: actor.deviceHash, requestId: 'media-citizen' };
    }
    if (actor.kind === 'partner') {
      return {
        scope: 'partner',
        userId: actor.userId,
        institutionId: actor.institutionId,
        requestId: 'media-partner',
      };
    }
    return { scope: 'admin', userId: actor.userId, requestId: 'media-admin' };
  }

  async list(publicId: string, actor: Actor | null): Promise<ReportMediaItem[]> {
    const rows = await this.run(
      async (tx) => {
        const report = await this.loadReport(tx, publicId, actor);
        if (report === null) {
          return null;
        }
        return this.repository.listMediaFor(tx, report.id);
      },
      this.contextFor(actor),
    );
    if (rows === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    return toMediaItems(publicId, rows);
  }

  async read(
    publicId: string,
    mediaId: string,
    actor: Actor | null,
  ): Promise<MediaObject> {
    const found = await this.run(
      async (tx) => {
        const report = await this.loadReport(tx, publicId, actor);
        if (report === null) {
          return null;
        }
        return this.repository.findMediaForReport(tx, report.id, mediaId);
      },
      this.contextFor(actor),
    );
    if (found === null) {
      throw new AppError('NOT_FOUND', { detail: 'Media tidak ditemukan.' });
    }
    if (!mediaVisibleTo(found.status, actor)) {
      throw new AppError('NOT_FOUND', { detail: 'Media tidak ditemukan.' });
    }
    if (found.objectKey.length === 0) {
      throw new AppError('NOT_FOUND', { detail: 'Media tidak tersedia.' });
    }
    const bytes = await this.storage.get(found.objectKey);
    if (bytes === null) {
      throw new AppError('NOT_FOUND', { detail: 'Media tidak tersedia.' });
    }
    return { bytes, mime: found.mime, publicId };
  }

  private async loadReport(
    tx: Parameters<Parameters<TransactionRunner>[0]>[0],
    publicId: string,
    actor: Actor | null,
  ): Promise<{ id: string } | null> {
    if (actor === null) {
      const report = await this.repository.findPublicByPublicId(tx, publicId);
      return report === null ? null : { id: report.id };
    }
    if (actor.kind === 'citizen') {
      const report = await this.repository.findOwnedByPublicId(tx, publicId, actor.deviceHash);
      return report === null ? null : { id: report.id };
    }
    if (actor.kind === 'partner') {
      const report = await this.repository.findInInstitution(
        tx,
        publicId,
        actor.institutionId,
      );
      return report === null ? null : { id: report.id };
    }
    const report = await this.repository.findByPublicId(tx, publicId);
    return report === null ? null : { id: report.id };
  }
}
