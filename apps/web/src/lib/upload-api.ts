import type { UploadRequest } from '@hadir/contracts';
import { apiPutBinary, apiSendChecked } from './api';
import { storedUploadSchema, uploadTicketSchema, type StoredUpload } from './guards';
import { compressPhoto, photoIssue, type CompressedPhoto } from './photo';

const UPLOAD_PATH = '/v1/uploads';

type UploadPurpose = UploadRequest['purpose'];

export interface UploadedPhoto {
  uploadId: string;
  bytes: number;
  width: number;
  height: number;
}

async function ticketFor(
  contentType: string,
  size: number,
  purpose: UploadPurpose,
  idempotencyKey: string,
) {
  const envelope = await apiSendChecked(UPLOAD_PATH, uploadTicketSchema, {
    method: 'POST',
    body: { contentType, size, purpose },
    idempotencyKey,
  });
  return envelope.data;
}

async function putBytes(
  ticket: { url: string; headers: Record<string, string> },
  blob: Blob,
): Promise<StoredUpload> {
  const envelope = await apiPutBinary<unknown>(ticket.url, blob, {
    headers: ticket.headers,
    timeoutMs: 60_000,
  });
  const parsed = storedUploadSchema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new Error('Respons unggah tidak sesuai kontrak.');
  }
  return parsed.data;
}

export async function uploadPhoto(
  file: File,
  purpose: UploadPurpose,
  idempotencyKey: string,
): Promise<UploadedPhoto> {
  const issue = photoIssue(file);
  if (issue !== null) {
    throw new Error(issue);
  }
  const compressed = await compressPhoto(file);
  return uploadCompressed(compressed, purpose, idempotencyKey);
}

export async function uploadCompressed(
  compressed: CompressedPhoto,
  purpose: UploadPurpose,
  idempotencyKey: string,
): Promise<UploadedPhoto> {
  const ticket = await ticketFor(compressed.blob.type, compressed.blob.size, purpose, idempotencyKey);
  const stored = await putBytes(ticket, compressed.blob);
  return {
    uploadId: stored.uploadId,
    bytes: compressed.blob.size,
    width: stored.width,
    height: stored.height,
  };
}