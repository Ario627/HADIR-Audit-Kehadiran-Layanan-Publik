const HEX = '0123456789abcdef';
const MAX_TIMESTAMP = 0xffffffffffff;

export function uuidv7(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError('Timestamp UUIDv7 harus berada pada rentang 48 bit.');
  }

  const bytes = new Uint8Array(16);
  let remaining = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  crypto.getRandomValues(bytes.subarray(6));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  let output = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    output += HEX.charAt(byte >>> 4) + HEX.charAt(byte & 0x0f);
    if (index === 3 || index === 5 || index === 7 || index === 9) {
      output += '-';
    }
  }
  return output;
}