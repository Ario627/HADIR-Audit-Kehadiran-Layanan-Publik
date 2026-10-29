import {
  STOP_CODE_PATTERN,
  readQrProof,
  readQrSearch,
  readStopCode,
  type QrSearchInput,
} from './qr';

export type ScanErrorKind =
  | 'empty'
  | 'too_long'
  | 'bad_scheme'
  | 'foreign_origin'
  | 'not_stop'
  | 'bad_code';

export interface ScanTarget {
  stopCode: string;
  search: QrSearchInput;
}

export type ScanOutcome =
  | { kind: 'ok'; target: ScanTarget }
  | { kind: 'error'; error: ScanErrorKind };

const MAX_SCAN_TEXT = 512;
const STOP_PATH = /^\/s\/([A-Za-z0-9-]{3,12})\/?$/;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const SEARCH_KEYS = ['e', 'k', 's', 'w'] as const;

function fail(error: ScanErrorKind): ScanOutcome {
  return { kind: 'error', error };
}

function hasScheme(value: string): boolean {
  return SCHEME_PATTERN.test(value);
}

function isBareCode(value: string): boolean {
  return STOP_CODE_PATTERN.test(value.toUpperCase());
}

function readSearch(params: URLSearchParams): QrSearchInput {
  const record: Record<string, string> = {};
  for (const key of SEARCH_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      record[key] = value;
    }
  }
  const parsed = readQrSearch(record);
  const proof = readQrProof({ e: parsed.e, k: parsed.k, s: parsed.s });
  const output: QrSearchInput = {};
  if (proof !== null) {
    output.e = proof.epoch;
    output.k = proof.keyId;
    output.s = proof.signature;
  }
  if (parsed.w === '30d') {
    output.w = '30d';
  }
  return output;
}

function parseUrl(text: string, baseOrigin: string): URL | null {
  try {
    return new URL(text, baseOrigin);
  } catch {
    return null;
  }
}

export function readScannedText(raw: unknown, baseOrigin: string): ScanOutcome {
  if (typeof raw !== 'string') {
    return fail('empty');
  }
  const text = raw.trim();
  if (text.length === 0) {
    return fail('empty');
  }
  if (text.length > MAX_SCAN_TEXT) {
    return fail('too_long');
  }

  if (isBareCode(text)) {
    const stopCode = readStopCode(text);
    return stopCode === null ? fail('bad_code') : { kind: 'ok', target: { stopCode, search: {} } };
  }

  if (!hasScheme(text) && !text.startsWith('/')) {
    return fail('not_stop');
  }

  if (hasScheme(text)) {
    const scheme = text.slice(0, text.indexOf(':') + 1).toLowerCase();
    if (!ALLOWED_PROTOCOLS.has(scheme)) {
      return fail('bad_scheme');
    }
  }

  const url = parseUrl(text, baseOrigin);
  if (url === null) {
    return fail('not_stop');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return fail('bad_scheme');
  }
  if (url.origin !== baseOrigin || url.username.length > 0 || url.password.length > 0) {
    return fail('foreign_origin');
  }

  const match = STOP_PATH.exec(url.pathname);
  if (match === null) {
    return fail('not_stop');
  }
  const stopCode = readStopCode(match[1]);
  if (stopCode === null) {
    return fail('bad_code');
  }
  return { kind: 'ok', target: { stopCode, search: readSearch(url.searchParams) } };
}

export function scanErrorCopy(error: ScanErrorKind): string {
  switch (error) {
    case 'empty':
      return 'Kode atau tautan kosong. Coba pindai ulang.';
    case 'too_long':
      return 'Teks yang dipindai terlalu panjang untuk kode halte.';
    case 'bad_scheme':
      return 'Tautan ini bukan alamat web. Hanya tautan HADIR yang diterima.';
    case 'foreign_origin':
      return 'Tautan ini menunjuk situs lain. Pindai QR yang menempel di halte HADIR.';
    case 'not_stop':
      return 'Tautan tidak menunjuk halaman halte.';
    case 'bad_code':
      return 'Kode halte pada tautan tidak sesuai format.';
  }
}