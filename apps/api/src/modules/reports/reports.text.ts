import { AppError } from '../../common/errors/app-error';

export const MIN_TEXT_LENGTH = 20;
export const MAX_NOTE_LENGTH = 280;

function isPrintable(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) {
    return true;
  }
  return code >= 32 && code !== 127;
}

export function sanitizeText(raw: string): string {
  let printable = '';
  for (const character of raw) {
    if (isPrintable(character.codePointAt(0) ?? 0)) {
      printable += character;
    }
  }
  const lines = printable
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  return lines.join('\n');
}

export function assertUsableText(raw: string): string {
  const text = sanitizeText(raw);
  if (text.length < MIN_TEXT_LENGTH) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Teks laporan terlalu pendek setelah dibersihkan.',
      errors: [
        {
          field: 'text',
          code: 'too_short',
          message: `Tulis minimal ${MIN_TEXT_LENGTH} karakter yang dapat dibaca.`,
        },
      ],
    });
  }
  return text;
}

export function sanitizeNote(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const note = sanitizeText(raw);
  return note.length === 0 ? null : note.slice(0, MAX_NOTE_LENGTH);
}
