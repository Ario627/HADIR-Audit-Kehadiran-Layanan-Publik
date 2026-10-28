import { sanitizeImage } from './sanitize-image';

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(marker, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function jpegWithExif(): Buffer {
  const app0 = jpegSegment(
    0xffe0,
    Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  );
  const app1 = jpegSegment(0xffe1, Buffer.from('Exif\u0000\u0000MM secret gps payload', 'latin1'));
  const comment = jpegSegment(0xfffe, Buffer.from('shot on device 123', 'latin1'));
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, comment, sos]);
}

function pngWithText(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, payload: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, payload, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    signature,
    chunk('IHDR', Buffer.alloc(13, 1)),
    chunk('tEXt', Buffer.from('Author\u0000Budi', 'latin1')),
    chunk('eXIf', Buffer.from('gps payload', 'latin1')),
    chunk('IDAT', Buffer.from([1, 2, 3, 4])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function webpWithExif(): Buffer {
  const chunk = (type: string, payload: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32LE(payload.length, 4);
    const padding = payload.length % 2 === 0 ? Buffer.alloc(0) : Buffer.alloc(1);
    return Buffer.concat([header, payload, padding]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04;
  const body = Buffer.concat([
    chunk('VP8X', vp8x),
    chunk('EXIF', Buffer.from('gps coords', 'latin1')),
    chunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1')),
    chunk('VP8 ', Buffer.from([9, 9, 9, 9])),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

function containsAscii(bytes: Buffer, needle: string): boolean {
  return bytes.includes(Buffer.from(needle, 'latin1'));
}

describe('sanitizeImage on JPEG', () => {
  it('strips APP1 and comments but keeps JFIF and scan data', () => {
    const input = jpegWithExif();
    const result = sanitizeImage(input, 'image/jpeg');

    expect(result.changed).toBe(true);
    expect(result.stripped).toContain('exif_or_xmp');
    expect(result.stripped).toContain('comment');
    expect(containsAscii(result.bytes, 'secret gps payload')).toBe(false);
    expect(containsAscii(result.bytes, 'shot on device')).toBe(false);
    expect(containsAscii(result.bytes, 'JFIF')).toBe(true);
    expect(result.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(result.bytes.includes(Buffer.from([0xff, 0xda]))).toBe(true);
  });

  it('leaves a clean JPEG untouched byte for byte', () => {
    const clean = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 1, 2, 3]);
    const result = sanitizeImage(clean, 'image/jpeg');
    expect(result.changed).toBe(false);
    expect(result.bytes.equals(clean)).toBe(true);
  });

  it('refuses to rewrite a malformed stream', () => {
    const broken = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00]);
    const result = sanitizeImage(broken, 'image/jpeg');
    expect(result.changed).toBe(false);
    expect(result.bytes.equals(broken)).toBe(true);
  });

  it('returns non JPEG input unchanged', () => {
    const other = Buffer.from('not an image at all', 'utf8');
    expect(sanitizeImage(other, 'image/jpeg').bytes.equals(other)).toBe(true);
  });
});

describe('sanitizeImage on PNG', () => {
  it('drops text and exif chunks but keeps the data chunks', () => {
    const result = sanitizeImage(pngWithText(), 'image/png');

    expect(result.changed).toBe(true);
    expect(result.stripped).toEqual(['tEXt', 'eXIf']);
    expect(containsAscii(result.bytes, 'Author')).toBe(false);
    expect(containsAscii(result.bytes, 'gps payload')).toBe(false);
    expect(containsAscii(result.bytes, 'IHDR')).toBe(true);
    expect(containsAscii(result.bytes, 'IDAT')).toBe(true);
    expect(containsAscii(result.bytes, 'IEND')).toBe(true);
    expect(result.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('leaves a clean PNG untouched', () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0, 0);
    header.write('IEND', 4, 'latin1');
    const clean = Buffer.concat([signature, header, Buffer.alloc(4)]);
    expect(sanitizeImage(clean, 'image/png').changed).toBe(false);
  });

  it('refuses a truncated chunk table', () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const broken = Buffer.concat([signature, Buffer.from([0, 0, 0, 99, 0x74, 0x45, 0x58, 0x74])]);
    expect(sanitizeImage(broken, 'image/png').bytes.equals(broken)).toBe(true);
  });
});

describe('sanitizeImage on WebP', () => {
  it('drops EXIF and XMP, clears VP8X flags and fixes the RIFF size', () => {
    const result = sanitizeImage(webpWithExif(), 'image/webp');

    expect(result.changed).toBe(true);
    expect(result.stripped).toEqual(['EXIF', 'XMP']);
    expect(containsAscii(result.bytes, 'gps coords')).toBe(false);
    expect(containsAscii(result.bytes, 'xmpmeta')).toBe(false);
    expect(result.bytes.toString('latin1', 0, 4)).toBe('RIFF');
    expect(result.bytes.toString('latin1', 8, 12)).toBe('WEBP');
    expect(result.bytes.readUInt32LE(4)).toBe(result.bytes.length - 8);

    const vp8xIndex = result.bytes.indexOf(Buffer.from('VP8X', 'latin1'));
    expect(vp8xIndex).toBeGreaterThan(0);
    const flags = result.bytes[vp8xIndex + 8]!;
    expect(flags & 0x08).toBe(0);
    expect(flags & 0x04).toBe(0);
  });

  it('leaves a clean WebP untouched', () => {
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(12, 4);
    header.write('WEBP', 8, 'latin1');
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write('VP8 ', 0, 'latin1');
    chunkHeader.writeUInt32LE(4, 4);
    const clean = Buffer.concat([header, chunkHeader, Buffer.from([1, 2, 3, 4])]);
    expect(sanitizeImage(clean, 'image/webp').changed).toBe(false);
  });

  it('returns non WebP input unchanged', () => {
    const other = Buffer.from('RIFF0000WAVEfmt ', 'latin1');
    expect(sanitizeImage(other, 'image/webp').bytes.equals(other)).toBe(true);
  });
});
