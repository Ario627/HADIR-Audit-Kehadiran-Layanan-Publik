export type SanitizableMime = 'image/jpeg' | 'image/png' | 'image/webp';

const JPEG_SOI = 0xffd8;
const JPEG_SOS = 0xffda;
const JPEG_EOI = 0xffd9;
const JPEG_APP1 = 0xffe1;
const JPEG_COMMENT = 0xfffe;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

const WEBP_DROP = new Set(['EXIF', 'XMP ']);
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

export interface SanitizeResult {
  bytes: Buffer;
  changed: boolean;
  stripped: readonly string[];
}

function sanitizeJpeg(input: Buffer): SanitizeResult {
  if (input.length < 4 || input.readUInt16BE(0) !== JPEG_SOI) {
    return { bytes: input, changed: false, stripped: [] };
  }
  const kept: Buffer[] = [input.subarray(0, 2)];
  const stripped: string[] = [];
  let offset = 2;

  while (offset + 3 < input.length) {
    if (input[offset] !== 0xff) {
      return { bytes: input, changed: false, stripped: [] };
    }
    const marker = input.readUInt16BE(offset);
    if (marker === JPEG_EOI) {
      break;
    }
    if (marker === JPEG_SOS) {
      kept.push(input.subarray(offset));
      return {
        bytes: Buffer.concat(kept),
        changed: stripped.length > 0,
        stripped,
      };
    }
    const length = input.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > input.length) {
      return { bytes: input, changed: false, stripped: [] };
    }
    const segment = input.subarray(offset, offset + 2 + length);
    if (marker === JPEG_APP1 || marker === JPEG_COMMENT) {
      stripped.push(marker === JPEG_APP1 ? 'exif_or_xmp' : 'comment');
    } else {
      kept.push(segment);
    }
    offset += 2 + length;
  }

  kept.push(input.subarray(Math.min(offset, input.length)));
  return { bytes: Buffer.concat(kept), changed: stripped.length > 0, stripped };
}

function sanitizePng(input: Buffer): SanitizeResult {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { bytes: input, changed: false, stripped: [] };
  }
  const kept: Buffer[] = [PNG_SIGNATURE];
  const stripped: string[] = [];
  let offset = 8;

  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > input.length) {
      return { bytes: input, changed: false, stripped: [] };
    }
    if (PNG_DROP.has(type)) {
      stripped.push(type);
    } else {
      kept.push(input.subarray(offset, end));
    }
    offset = end;
    if (type === 'IEND') {
      break;
    }
  }
  if (offset < input.length) {
    kept.push(input.subarray(offset));
  }
  return { bytes: Buffer.concat(kept), changed: stripped.length > 0, stripped };
}

function sanitizeWebp(input: Buffer): SanitizeResult {
  if (input.length < 12) {
    return { bytes: input, changed: false, stripped: [] };
  }
  if (input.toString('latin1', 0, 4) !== 'RIFF' || input.toString('latin1', 8, 12) !== 'WEBP') {
    return { bytes: input, changed: false, stripped: [] };
  }
  const chunks: { type: string; payload: Buffer }[] = [];
  const stripped: string[] = [];
  let offset = 12;

  while (offset + 8 <= input.length) {
    const type = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const paddedEnd = offset + 8 + size + (size % 2);
    if (offset + 8 + size > input.length) {
      return { bytes: input, changed: false, stripped: [] };
    }
    if (WEBP_DROP.has(type)) {
      stripped.push(type.trim());
    } else {
      chunks.push({ type, payload: input.subarray(offset, Math.min(paddedEnd, input.length)) });
    }
    offset = paddedEnd;
  }

  if (stripped.length === 0) {
    return { bytes: input, changed: false, stripped: [] };
  }

  const rebuilt: Buffer[] = [];
  for (const chunk of chunks) {
    if (chunk.type === 'VP8X' && chunk.payload.length >= 9) {
      const header = Buffer.from(chunk.payload);
      const copied = Buffer.from(header.subarray(8, 8 + 1));
      copied[0] = copied[0]! & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      copied.copy(header, 8);
      rebuilt.push(header);
    } else {
      rebuilt.push(chunk.payload);
    }
  }

  const body = Buffer.concat(rebuilt);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { bytes: Buffer.concat([header, body]), changed: true, stripped };
}

export function sanitizeImage(input: Buffer, mime: SanitizableMime): SanitizeResult {
  switch (mime) {
    case 'image/jpeg':
      return sanitizeJpeg(input);
    case 'image/png':
      return sanitizePng(input);
    case 'image/webp':
      return sanitizeWebp(input);
  }
}
