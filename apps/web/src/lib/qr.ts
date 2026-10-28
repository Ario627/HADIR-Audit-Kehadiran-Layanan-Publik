export const STOP_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,11}$/;
export const QR_EPOCH_PATTERN = /^(20\d{4}|r\d{1,3})$/;
export const QR_KEY_ID_PATTERN = /^[a-z0-9]{1,16}$/;
export const QR_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export interface QrProof {
  epoch: string;
  keyId: string;
  signature: string;
}

export interface QrSearchInput {
  e?: string;
  k?: string;
  s?: string;
  w?: string;
}

export function readStopCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return STOP_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function readQrProof(raw: QrSearchInput): QrProof | null {
  const { e, k, s } = raw;
  if (typeof e !== 'string' || typeof k !== 'string' || typeof s !== 'string') {
    return null;
  }
  if (!QR_EPOCH_PATTERN.test(e) || !QR_KEY_ID_PATTERN.test(k) || !QR_SIGNATURE_PATTERN.test(s)) {
    return null;
  }
  return { epoch: e, keyId: k, signature: s };
}

export function readQrSearch(raw: Record<string, unknown>): QrSearchInput {
  const output: QrSearchInput = {};
  if (typeof raw.e === 'string') {
    output.e = raw.e.slice(0, 16);
  }
  if (typeof raw.k === 'string') {
    output.k = raw.k.slice(0, 16);
  }
  if (typeof raw.s === 'string') {
    output.s = raw.s.slice(0, 22);
  }
  if (raw.w === '30d') {
    output.w = '30d';
  }
  return output;
}