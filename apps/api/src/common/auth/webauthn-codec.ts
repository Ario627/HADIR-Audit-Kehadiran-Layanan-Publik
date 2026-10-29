export function b64urlToBuffer(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function bufferToB64url(value: Buffer): string {
  return value.toString('base64url');
}

export function isB64urlShape(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}
