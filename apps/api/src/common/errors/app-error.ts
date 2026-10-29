export type ErrorCode =
  | 'BAD_REQUEST'
  | 'MALFORMED_JSON'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_MISSING'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'EPISODE_ALREADY_ACTIVE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'STOP_INACTIVE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_FAILED'
  | 'QR_INVALID'
  | 'QR_EXPIRED'
  | 'OUTCOME_INVALID'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'ESTIMATOR_UNAVAILABLE'
  | 'CONNECTOR_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface AppErrorOptions {
  detail?: string;
  errors?: readonly FieldError[];
  headers?: Readonly<Record<string, string>>;
  cause?: unknown;
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  MALFORMED_JSON: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_MISSING: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  EPISODE_ALREADY_ACTIVE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  INVALID_TRANSITION: 409,
  STOP_INACTIVE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  QR_INVALID: 422,
  QR_EXPIRED: 422,
  OUTCOME_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  ESTIMATOR_UNAVAILABLE: 503,
  CONNECTOR_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
};

const TITLE_BY_CODE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Permintaan tidak valid',
  MALFORMED_JSON: 'Body JSON tidak valid',
  UNAUTHENTICATED: 'Belum terautentikasi',
  FORBIDDEN: 'Tidak punya izin',
  CSRF_MISSING: 'Token CSRF tidak ditemukan',
  CSRF_INVALID: 'Token CSRF tidak valid',
  NOT_FOUND: 'Tidak ditemukan',
  METHOD_NOT_ALLOWED: 'Metode tidak didukung',
  EPISODE_ALREADY_ACTIVE: 'Episode sudah aktif',
  IDEMPOTENCY_CONFLICT: 'Kunci idempotensi bentrok',
  IDEMPOTENCY_KEY_REQUIRED: 'Kunci idempotensi wajib',
  INVALID_TRANSITION: 'Perubahan status tidak valid',
  STOP_INACTIVE: 'Halte tidak aktif',
  PAYLOAD_TOO_LARGE: 'Ukuran permintaan terlalu besar',
  UNSUPPORTED_MEDIA_TYPE: 'Tipe konten tidak didukung',
  VALIDATION_FAILED: 'Validasi gagal',
  QR_INVALID: 'Kode QR tidak valid',
  QR_EXPIRED: 'Kode QR sudah kedaluwarsa',
  OUTCOME_INVALID: 'Hasil episode tidak valid',
  RATE_LIMITED: 'Terlalu banyak permintaan',
  INTERNAL_ERROR: 'Terjadi kesalahan pada server',
  ESTIMATOR_UNAVAILABLE: 'Estimator tidak tersedia',
  CONNECTOR_UNAVAILABLE: 'Sumber data tidak tersedia',
  SERVICE_UNAVAILABLE: 'Layanan tidak tersedia',
};

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'INVALID_TRANSITION',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly errors: readonly FieldError[] | null;
  readonly headers: Readonly<Record<string, string>> | null;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const detail = options.detail ?? TITLE_BY_CODE[code];
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
    this.errors = options.errors && options.errors.length > 0 ? options.errors : null;
    this.headers = options.headers ?? null;
  }
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function titleForCode(code: ErrorCode): string {
  return TITLE_BY_CODE[code];
}

export function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

export function problemType(code: ErrorCode): string {
  return `https://hadir.id/problems/${code.toLowerCase().replaceAll('_', '-')}`;
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
