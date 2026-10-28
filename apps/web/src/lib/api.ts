import { forgetEtag, readCachedEnvelope, readEtag, rememberEtag } from './etag-cache';
export interface ApiMeta {
  requestId: string;
  generatedAt: string;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: ApiFieldError[];
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
  keepalive?: boolean;
}

interface ApiErrorOptions {
  status: number;
  code: string;
  requestId?: string | null;
  fieldErrors?: readonly ApiFieldError[];
  problem?: ProblemDetails | null;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DEVICE_BOOTSTRAP_TIMEOUT_MS = 8_000;
const DEVICE_BOOTSTRAP_PATH = '/v1/devices';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly fieldErrors: readonly ApiFieldError[];
  readonly problem: ProblemDetails | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.fieldErrors = Object.freeze([...(options.fieldErrors ?? [])]);
    this.problem = options.problem ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFieldErrors(value: unknown): ApiFieldError[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const output: ApiFieldError[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const field = readString(record, 'field');
    const code = readString(record, 'code');
    const message = readString(record, 'message');
    if (field !== null && code !== null && message !== null) {
      output.push({ field, code, message });
    }
  }
  return output.length > 0 ? output : null;
}

function parseProblem(value: unknown): ProblemDetails | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const status = typeof record.status === 'number' ? record.status : undefined;
  return {
    type: readString(record, 'type') ?? undefined,
    title: readString(record, 'title') ?? undefined,
    status,
    detail: readString(record, 'detail') ?? undefined,
    instance: readString(record, 'instance') ?? undefined,
    code: readString(record, 'code') ?? undefined,
    requestId: readString(record, 'requestId') ?? undefined,
    errors: readFieldErrors(record.errors) ?? undefined,
  };
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const entry of document.cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (entry.slice(0, separator).trim() === name) {
      const value = entry.slice(separator + 1);
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function csrfToken(): string | null {
  return readCookie('__Host-hadir_csrf') ?? readCookie('hadir_csrf');
}

let deviceBootstrap: Promise<void> | null = null;

async function bootstrapDevice(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${DEVICE_BOOTSTRAP_PATH}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DEVICE_BOOTSTRAP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError('Tidak bisa menyiapkan perangkat. Periksa koneksi.', {
      status: 0,
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
}

export function ensureDevice(): Promise<void> {
  if (csrfToken() !== null) {
    return Promise.resolve();
  }
  if (deviceBootstrap !== null) {
    return deviceBootstrap;
  }
  deviceBootstrap = bootstrapDevice().catch((error: unknown) => {
    deviceBootstrap = null;
    throw error;
  });
  return deviceBootstrap;
}

function clearCsrfCookie(): void {
  if (typeof document === 'undefined') {
    return;
  }
  for (const name of ['__Host-hadir_csrf', 'hadir_csrf']) {
    const secure = name.startsWith('__Host-') ? '; Secure' : '';
    document.cookie = `${name}=; Max-Age=0; Path=/${secure}`;
  }
}

export function resetDevice(): void {
  deviceBootstrap = null;
  clearCsrfCookie();
}

async function toApiError(response: Response): Promise<ApiError> {
  let problem: ProblemDetails | null = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      problem = parseProblem(await response.json());
    } catch {
      problem = null;
    }
  }
  const requestId = response.headers.get('x-request-id') ?? problem?.requestId ?? null;
  const code = problem?.code ?? `HTTP_${response.status}`;
  const message =
    problem?.detail ?? problem?.title ?? `Permintaan gagal (${response.status}).`;
  return new ApiError(message, {
    status: response.status,
    code,
    requestId,
    fieldErrors: problem?.errors ?? [],
    problem,
    retryAfterSeconds: readRetryAfter(response),
  });
}

const RECOVERABLE_SESSION_CODES = new Set(['CSRF_INVALID', 'CSRF_MISSING', 'UNAUTHENTICATED']);

function isRecoverableSessionError(error: unknown): boolean {
  return error instanceof ApiError && RECOVERABLE_SESSION_CODES.has(error.code);
}

function parseEnvelope<T>(value: unknown, fallbackRequestId: string): ApiEnvelope<T> | null {
  const record = asRecord(value);
  if (record === null || !Object.hasOwn(record, 'data')) {
    return null;
  }
  const metaRecord = asRecord(record.meta);
  const nextCursor = metaRecord?.nextCursor;
  const hasMore = metaRecord?.hasMore;
  return {
    data: record.data as T,
    meta: {
      requestId: readString(metaRecord, 'requestId') ?? fallbackRequestId,
      generatedAt: readString(metaRecord, 'generatedAt') ?? new Date().toISOString(),
      ...(typeof nextCursor === 'string' || nextCursor === null ? { nextCursor } : {}),
      ...(typeof hasMore === 'boolean' ? { hasMore } : {}),
    },
  };
}

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400 ? Math.ceil(seconds) : null;
}

function isPublicCacheable(response: Response): boolean {
  const policy = response.headers.get('cache-control') ?? '';
  return !/no-store|private/i.test(policy);
}

async function performRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  allowConditionalRetry = true,
): Promise<ApiEnvelope<T>> {
  const method = options.method ?? 'GET';
  const isWrite = method !== 'GET';
  if (isWrite) {
    await ensureDevice();
  }

  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey !== undefined) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  const csrf = csrfToken();
  if (csrf !== null) {
    headers.set('X-CSRF-Token', csrf);
  }
  if (method === 'GET') {
    const known = readEtag(path);
    if (known !== null) {
      headers.set('If-None-Match', known);
    }
  }

  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? (isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS),
  );
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      signal,
      ...(options.keepalive === true ? { keepalive: true } : {}),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted === true) {
      throw error;
    }
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ApiError('Server tidak merespons tepat waktu.', {
        status: 0,
        code: 'TIMEOUT',
        cause: error,
      });
    }
    throw new ApiError('Tidak bisa menghubungi server. Periksa koneksi.', {
      status: 0,
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }

  if (response.status === 304) {
    const cached = readCachedEnvelope<ApiEnvelope<T>>(path);
    if (cached !== null) {
      return cached;
    }
    if (!allowConditionalRetry) {
      throw new ApiError('Server mengirim 304 tanpa salinan lokal.', {
        status: 304,
        code: 'INVALID_RESPONSE',
      });
    }
    forgetEtag(path);
    return performRequest<T>(path, options, false);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  const requestId = response.headers.get('x-request-id') ?? '';
  if (response.status === 204) {
    return {
      data: undefined as T,
      meta: { requestId, generatedAt: new Date().toISOString() },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError('Respons server tidak berisi JSON yang valid.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
      requestId,
      cause: error,
    });
  }

  const envelope = parseEnvelope<T>(payload, requestId);
  if (envelope === null) {
    throw new ApiError('Respons server tidak sesuai kontrak.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
      requestId,
    });
  }
  const etag = response.headers.get('etag');
  if (etag !== null && method === 'GET' && isPublicCacheable(response)) {
    rememberEtag(path, etag, envelope);
  }
  return envelope;
}

type ReadOptions = Omit<ApiRequestOptions, 'method' | 'body' | 'idempotencyKey'>;
type WriteOptions = Omit<ApiRequestOptions, 'method' | 'body'>;

function isReplayable(options: ApiRequestOptions): boolean {
  const method = options.method ?? 'GET';
  return method === 'GET' || options.idempotencyKey !== undefined;
}

function shouldResetDevice(path: string, error: unknown): boolean {
  if (!isRecoverableSessionError(error)) {
    return false;
  }
  return !path.startsWith('/v1/partner');
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<T>> {
  try {
    return await performRequest<T>(path, options);
  } catch (error) {
    if (!isReplayable(options) || !shouldResetDevice(path, error)) {
      throw error;
    }
    resetDevice();
    return performRequest<T>(path, options);
  }
}

export interface PayloadSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function assertContract<T>(envelope: ApiEnvelope<unknown>, schema: PayloadSchema<T>): ApiEnvelope<T> {
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new ApiError('Respons server tidak sesuai kontrak.', {
      status: 0,
      code: 'CONTRACT_MISMATCH',
      requestId: envelope.meta.requestId,
    });
  }
  return { data: parsed.data, meta: envelope.meta };
}

export function apiGet<T>(path: string, options: ReadOptions = {}): Promise<ApiEnvelope<T>> {
  return apiRequest<T>(path, { ...options, method: 'GET' });
}

export async function apiSendChecked<T>(
  path: string,
  schema: PayloadSchema<T>,
  options: ApiRequestOptions,
): Promise<ApiEnvelope<T>> {
  return assertContract(await apiRequest<unknown>(path, options), schema);
}

export async function apiGetChecked<T>(
  path: string,
  schema: PayloadSchema<T>,
  options: ReadOptions = {},
): Promise<ApiEnvelope<T>> {
  return apiSendChecked(path, schema, { ...options, method: 'GET' });
}

export function apiPost<T>(
  path: string,
  body: unknown,
  options: WriteOptions = {},
): Promise<ApiEnvelope<T>> {
  return apiRequest<T>(path, { ...options, method: 'POST', body });
}
export function apiPatch<T>(
  path: string,
  body: unknown,
  options: WriteOptions = {},
): Promise<ApiEnvelope<T>> {
  return apiRequest<T>(path, { ...options, method: 'PATCH', body });
}

async function performPutBinary<T>(
  path: string,
  body: Blob,
  options: { headers?: HeadersInit; timeoutMs?: number },
): Promise<ApiEnvelope<T>> {
  await ensureDevice();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const csrf = csrfToken();
  if (csrf !== null) {
    headers.set('X-CSRF-Token', csrf);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? WRITE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError('Tidak bisa mengunggah berkas. Periksa koneksi.', {
      status: 0,
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  const requestId = response.headers.get('x-request-id') ?? '';
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError('Respons unggah tidak berisi JSON yang valid.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
      requestId,
      cause: error,
    });
  }

  const envelope = parseEnvelope<T>(payload, requestId);
  if (envelope === null) {
    throw new ApiError('Respons unggah tidak sesuai kontrak.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
      requestId,
    });
  }
  return envelope;
}

export async function apiPutBinary<T>(
  path: string,
  body: Blob,
  options: { headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<ApiEnvelope<T>> {
  try {
    return await performPutBinary<T>(path, body, options);
  } catch (error) {
    if (!shouldResetDevice(path, error)) {
      throw error;
    }
    resetDevice();
    return performPutBinary<T>(path, body, options);
  }
}

export async function apiFetchBlob(
  path: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Blob> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: '*/*' },
      credentials: 'include',
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted === true) {
      throw error;
    }
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ApiError('Unduhan tidak selesai tepat waktu.', {
        status: 0,
        code: 'TIMEOUT',
        cause: error,
      });
    }
    throw new ApiError('Tidak bisa mengunduh berkas. Periksa koneksi.', {
      status: 0,
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.blob();
}

export function withQuery(
  path: string,
  params: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      search.set(key, String(value));
    }
  }
  const serialized = search.toString();
  return serialized.length === 0 ? path : `${path}?${serialized}`;
}

function hasUnsafeChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || char === '\\') {
      return true;
    }
  }
  return false;
}

export function apiAssetUrl(path: string | null): string | null {
  if (path === null) {
    return null;
  }
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    return null;
  }
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }
  if (hasUnsafeChars(trimmed)) {
    return null;
  }
  return `${API_BASE_URL}${trimmed}`;
}