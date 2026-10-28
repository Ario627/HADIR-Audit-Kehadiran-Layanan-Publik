export const MAX_PHOTO_EDGE = 1600;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const JPEG_QUALITY = 0.8;

const ACCEPTED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PhotoSize {
  width: number;
  height: number;
}

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export type PhotoIssue = 'unsupported_type' | 'empty' | 'too_large';

export function isAcceptedPhoto(file: { type: string; size: number }): boolean {
  return ACCEPTED_MIMES.has(file.type) && file.size > 0;
}

export function photoIssue(file: { type: string; size: number }): PhotoIssue | null {
  if (file.size <= 0) {
    return 'empty';
  }
  if (!ACCEPTED_MIMES.has(file.type)) {
    return 'unsupported_type';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'too_large';
  }
  return null;
}

export function fitWithin(size: PhotoSize, maxEdge: number = MAX_PHOTO_EDGE): PhotoSize {
  const longest = Math.max(size.width, size.height);
  if (longest <= 0 || maxEdge <= 0) {
    return { width: 1, height: 1 };
  }
  if (longest <= maxEdge) {
    return { width: Math.round(size.width), height: Math.round(size.height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  const megabytes = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${megabytes} MB`;
}

async function decodePhoto(file: File): Promise<CanvasImageSource & PhotoSize> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const source = await decodePhoto(file);
  const target = fitWithin({ width: source.width, height: source.height });
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Kanvas gambar tidak tersedia di peramban ini.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0, target.width, target.height);
  if ('close' in source && typeof source.close === 'function') {
    source.close();
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });
  if (blob === null) {
    throw new Error('Gambar tidak bisa dikompres di peramban ini.');
  }
  return { blob, width: target.width, height: target.height };
}