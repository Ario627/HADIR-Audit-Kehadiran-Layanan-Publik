import { ImageRejected, MAX_IMAGE_BYTES, sniffImage } from './image-sniff';

function png(width: number, height: number, extra = 0): Buffer {
  const bytes = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number, withExif: boolean): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (withExif) {
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), Buffer.alloc(24, 1)]);
    const segment = Buffer.alloc(4 + payload.length);
    segment.writeUInt16BE(0xffe1, 0);
    segment.writeUInt16BE(payload.length + 2, 2);
    payload.copy(segment, 4);
    parts.push(segment);
  }
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);
  parts.push(Buffer.alloc(40, 0));
  return Buffer.concat(parts);
}

function webpVp8x(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(40);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(32, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

describe('sniffImage', () => {
  it('reads PNG dimensions', () => {
    expect(sniffImage(png(320, 240))).toMatchObject({ mime: 'image/png', width: 320, height: 240 });
  });

  it('reads JPEG dimensions and flags EXIF', () => {
    expect(sniffImage(jpeg(800, 600, true))).toMatchObject({
      mime: 'image/jpeg',
      width: 800,
      height: 600,
      hasExif: true,
    });
  });

  it('reports a JPEG without EXIF as clean', () => {
    expect(sniffImage(jpeg(100, 100, false)).hasExif).toBe(false);
  });

  it('reads WebP VP8X dimensions', () => {
    expect(sniffImage(webpVp8x(1024, 768))).toMatchObject({ mime: 'image/webp', width: 1024, height: 768 });
  });

  it('rejects GIF', () => {
    const gif = Buffer.alloc(40);
    gif.write('GIF89a', 0, 'ascii');
    expect(() => sniffImage(gif)).toThrow(ImageRejected);
  });

  it('rejects SVG even when it pretends to be a raster image', () => {
    const svg = Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(64)}</svg>`);
    expect(() => sniffImage(svg)).toThrow(ImageRejected);
  });

  it('rejects a file that claims an image type but is plain text', () => {
    expect(() => sniffImage(Buffer.alloc(64, 0x41))).toThrow(ImageRejected);
  });

  it('rejects a decompression bomb by dimensions', () => {
    expect(() => sniffImage(png(9000, 9000))).toThrow(ImageRejected);
  });

  it('rejects a JPEG whose dimensions exceed the cap', () => {
    expect(() => sniffImage(jpeg(9000, 100, false))).toThrow(ImageRejected);
  });

  it('rejects files above 5 MB', () => {
    const big = Buffer.concat([png(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => sniffImage(big)).toThrow(ImageRejected);
  });

  it('rejects a truncated header', () => {
    expect(() => sniffImage(Buffer.alloc(4, 0xff))).toThrow(ImageRejected);
  });

  it('rejects a PNG with zero width', () => {
    expect(() => sniffImage(png(0, 100))).toThrow(ImageRejected);
  });

  it('rejects a JPEG with no frame header', () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 0)]);
    expect(() => sniffImage(broken)).toThrow(ImageRejected);
  });
});
