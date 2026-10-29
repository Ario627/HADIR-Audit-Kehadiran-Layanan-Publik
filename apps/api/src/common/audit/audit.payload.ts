const MAX_KEYS = 16;
const MAX_KEY_LENGTH = 64;
const MAX_STRING_LENGTH = 256;
const MAX_ARRAY_LENGTH = 8;
const MAX_DEPTH = 2;
const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function isLogSafe(code: number): boolean {
  if (code < 32 || code === 127) {
    return false;
  }
  return code < 0x2028 || code > 0x202e;
}

export function sanitizeAuditString(raw: string): string {
  let safe = '';
  for (const character of raw) {
    if (safe.length >= MAX_STRING_LENGTH) {
      break;
    }
    if (isLogSafe(character.codePointAt(0) ?? 0)) {
      safe += character;
    }
  }
  return safe;
}

function sanitizeScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeAuditString(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeAuditPayload(value as Record<string, unknown>, depth + 1);
  }
  return sanitizeScalar(value);
}

export function sanitizeAuditPayload(
  payload: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (kept >= MAX_KEYS) {
      break;
    }
    if (BLOCKED_KEYS.has(key)) {
      continue;
    }
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      continue;
    }
    clean[sanitizeAuditString(key)] = sanitizeValue(value, depth);
    kept += 1;
  }
  return clean;
}