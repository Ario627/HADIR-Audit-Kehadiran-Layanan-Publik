import { z } from 'zod';
import { AppError } from '../errors/app-error';

const CursorPayload = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();

export interface CursorValue {
  createdAt: Date;
  id: string;
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', {
    detail: 'Cursor tidak valid.',
    errors: [
      {
        field: 'cursor',
        code: 'invalid_cursor',
        message: 'Cursor tidak valid atau sudah rusak.',
      },
    ],
  });
}

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: value.createdAt.toISOString(),
      id: value.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(raw: string): CursorValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const result = CursorPayload.safeParse(parsed);
  if (!result.success) {
    throw invalidCursor();
  }
  return {
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  };
}