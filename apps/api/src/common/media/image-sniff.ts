export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const ALLOWED_IMAGE_MIMES: readonly ImageMime[] = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 8_000;

const MIN_HEADER_BYTES = 32;

const FORBIDDEN_SIGNATURES: readonly { label: string; bytes: readonly number[] }[] = Object.freeze([
  { label: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { label: 'image/heic', bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63] },
]);

export interface ImageFacts {
  mime: ImageMime;
  width: number;
  height: number;
  hasExif: boolean;
}

export class ImageRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImageRejected';
  }
}

function startsWith(bytes: Buffer, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((value, index) => bytes[offset + index] === value);
}

function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8').trimStart();
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.toLowerCase().includes('<svg');
}

function parsePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24) {
    throw new ImageRejected('truncated', 'Berkas PNG terpotong.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function parseJpeg(bytes: Buffer): { width: number; height: number; hasExif: boolean } {
  let offset = 2;
  let hasExif = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) {
      throw new ImageRejected('malformed', 'Segmen JPEG tidak valid.');
    }
    if (marker === 0xe1 && startsWith(bytes, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00], offset + 4)) {
      hasExif = true;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) {
        throw new ImageRejected('truncated', 'Berkas JPEG terpotong.');
      }
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
        hasExif,
      };
    }
    offset += 2 + length;
  }
  throw new ImageRejected('no_frame', 'Dimensi JPEG tidak ditemukan.');
}

function parseWebp(bytes: Buffer): { width: number; height: number } {
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    if (bytes.length < 30) {
      throw new ImageRejected('truncated', 'Berkas WebP terpotong.');
    }
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) {
      throw new ImageRejected('truncated', 'Berkas WebP terpotong.');
    }
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25) {
      throw new ImageRejected('truncated', 'Berkas WebP terpotong.');
    }
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new ImageRejected('unsupported_webp', 'Varian WebP tidak didukung.');
}

export function sniffImage(bytes: Buffer): ImageFacts {
  if (bytes.length < MIN_HEADER_BYTES) {
    throw new ImageRejected('too_small', 'Berkas terlalu kecil untuk sebuah gambar.');
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageRejected('too_large', 'Ukuran gambar melebihi 5 MB.');
  }
  for (const forbidden of FORBIDDEN_SIGNATURES) {
    if (startsWith(bytes, forbidden.bytes)) {
      throw new ImageRejected('mime_forbidden', `Format ${forbidden.label} tidak diterima.`);
    }
  }

  let facts: ImageFacts;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const parsed = parseJpeg(bytes);
    facts = { mime: 'image/jpeg', width: parsed.width, height: parsed.height, hasExif: parsed.hasExif };
  } else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const parsed = parsePng(bytes);
    facts = { mime: 'image/png', width: parsed.width, height: parsed.height, hasExif: false };
  } else if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    const parsed = parseWebp(bytes);
    facts = { mime: 'image/webp', width: parsed.width, height: parsed.height, hasExif: false };
  } else if (isSvg(bytes)) {
    throw new ImageRejected('mime_forbidden', 'SVG tidak diterima.');
  } else {
    throw new ImageRejected('mime_unknown', 'Isi berkas bukan JPEG, PNG, atau WebP.');
  }

  if (facts.width <= 0 || facts.height <= 0) {
    throw new ImageRejected('dimensions_invalid', 'Dimensi gambar tidak valid.');
  }
  if (facts.width > MAX_IMAGE_EDGE || facts.height > MAX_IMAGE_EDGE) {
    throw new ImageRejected('dimensions_too_large', 'Dimensi gambar melebihi 8000 piksel.');
  }
  return facts;
}
