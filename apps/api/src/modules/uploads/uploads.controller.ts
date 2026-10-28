import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UploadRequest } from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { MAX_IMAGE_BYTES } from '../../common/media/image-sniff';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { contextOf, deviceOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { UploadsService } from './uploads.service';

const NO_STORE = 'no-store, private, max-age=0';

async function readRawBody(request: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > limit) {
        cleanup();
        reject(new AppError('PAYLOAD_TOO_LARGE', { detail: 'Berkas melebihi 5 MB.' }));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      cleanup();
      if (total === 0) {
        reject(new AppError('VALIDATION_FAILED', { detail: 'Berkas kosong.' }));
        return;
      }
      resolve(Buffer.concat(chunks, total));
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.upload)
  async create(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(UploadRequest, body);
    const device = deviceOf(request);
    const context = contextOf(request);
    const ticket = await this.uploads.createTicket(input, {
      requestId: context.requestId,
      deviceHash: device.hash,
    });
    return ok(ticket, requestIdOf(request));
  }

  @Put(':uploadId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.upload)
  async store(@Param('uploadId') uploadId: string, @Req() request: Request) {
    const token = request.header('x-upload-token') ?? null;
    const bytes = await readRawBody(request, MAX_IMAGE_BYTES);
    const device = deviceOf(request);
    const context = contextOf(request);
    const stored = await this.uploads.store(
      parseOrThrowString(uploadId),
      token,
      request.header('content-type'),
      bytes,
      { requestId: context.requestId, deviceHash: device.hash },
    );
    return ok(
      {
        uploadId: stored.uploadId,
        mime: stored.mime,
        width: stored.width,
        height: stored.height,
        responsiveReady: false,
      },
      requestIdOf(request),
    );
  }
}

function parseOrThrowString(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', { detail: 'ID unggahan tidak valid.' });
  }
  return value;
}
