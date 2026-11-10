export const ANCHOR_SCHEMA_VERSION = 1;
export const ANCHOR_ALGORITHM = 'ed25519';
export const ANCHOR_ROOT_BYTES = 32;
export const ANCHOR_SIGNATURE_BYTES = 64;
export const ANCHOR_PUBLIC_KEY_BYTES = 32;
export const ANCHOR_KEY_ID_MAX = 64;
export const ANCHOR_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type AnchorStatus =
  | 'verified'
  | 'unsigned'
  | 'signature_missing'
  | 'signature_invalid'
  | 'key_mismatch'
  | 'structural_invalid'
  | 'window_inconsistent'
  | 'future_dated'
  | 'root_mismatch';

export interface AnchorEnvelope {
  anchorDate: string;
  merkleRootBase64: string;
  leafCount: number;
  windowStart: string;
  windowEnd: string;
  signingKeyId: string | null;
  signatureAlgorithm: string | null;
  signatureBase64: string | null;
  publicKeyBase64: string | null;
  signedAt: string | null;
}

export interface AnchorVerificationInput {
  envelope: AnchorEnvelope;
  now: string;
  trustedPublicKeys: Readonly<Record<string, string>>;
  recomputedRootBase64?: string | null;
  recomputedLeafCount?: number | null;
}

export interface AnchorCheck {
  code: string;
  ok: boolean;
  detail: string;
}

export interface AnchorVerification {
  status: AnchorStatus;
  signed: boolean;
  signatureWellFormed: boolean;
  keyTrusted: boolean;
  rootMatches: boolean;
  checks: readonly AnchorCheck[];
  warnings: readonly string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

function parseIso(raw: string): Date | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDate(raw: string): Date | null {
  if (!DATE_PATTERN.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === raw ? parsed : null;
}

export function decodedByteLength(base64: string | null): number | null {
  if (base64 === null || base64.length === 0 || !BASE64_PATTERN.test(base64)) {
    return null;
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function anchorPayloadLines(envelope: AnchorEnvelope): string[] {
  return [
    `hadir-anchor/v${ANCHOR_SCHEMA_VERSION}`,
    `date:${envelope.anchorDate}`,
    `root:${envelope.merkleRootBase64}`,
    `leaves:${envelope.leafCount}`,
    `window_start:${envelope.windowStart}`,
    `window_end:${envelope.windowEnd}`,
    `key:${envelope.signingKeyId ?? ''}`,
    `alg:${envelope.signatureAlgorithm ?? ''}`,
  ];
}

export function canonicalAnchorPayload(envelope: AnchorEnvelope): string {
  return `${anchorPayloadLines(envelope).join('\n')}\n`;
}

function normaliseBase64(value: string): string {
  return value.replace(/=+$/u, '');
}

export function sameBase64(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return false;
  }
  return normaliseBase64(left) === normaliseBase64(right);
}

export function trustedKeyFor(
  trusted: Readonly<Record<string, string>>,
  keyId: string | null,
): string | null {
  if (keyId === null) {
    return null;
  }
  const key = trusted[keyId];
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function signatureStructure(
  envelope: AnchorEnvelope,
  trusted: Readonly<Record<string, string>>,
): {
  signed: boolean;
  signatureWellFormed: boolean;
  keyTrusted: boolean;
  checks: AnchorCheck[];
} {
  const checks: AnchorCheck[] = [];
  const hasSignature = envelope.signatureBase64 !== null;
  const hasKeyId = envelope.signingKeyId !== null && envelope.signingKeyId.length > 0;
  const hasPublicKey = envelope.publicKeyBase64 !== null;
  const hasAlgorithm = envelope.signatureAlgorithm === ANCHOR_ALGORITHM;
  const hasSignedAt = envelope.signedAt !== null;

  const complete = hasSignature && hasKeyId && hasPublicKey && hasAlgorithm && hasSignedAt;
  checks.push({
    code: 'signature_complete',
    ok: complete,
    detail: complete
      ? 'Anchor membawa signature, kunci, algoritma, dan waktu tanda tangan.'
      : 'Anchor tidak membawa set tanda tangan yang lengkap.',
  });

  const signatureBytes = decodedByteLength(envelope.signatureBase64);
  const signatureWellFormed = signatureBytes === ANCHOR_SIGNATURE_BYTES;
  checks.push({
    code: 'signature_length',
    ok: signatureWellFormed,
    detail: signatureWellFormed
      ? 'Panjang tanda tangan sesuai Ed25519 (64 byte).'
      : `Panjang tanda tangan tidak sesuai: ${signatureBytes ?? 0} byte.`,
  });

  const publicKeyBytes = decodedByteLength(envelope.publicKeyBase64);
  const publicKeyWellFormed = publicKeyBytes === ANCHOR_PUBLIC_KEY_BYTES;
  checks.push({
    code: 'public_key_length',
    ok: publicKeyWellFormed,
    detail: publicKeyWellFormed
      ? 'Panjang kunci publik sesuai Ed25519 (32 byte).'
      : `Panjang kunci publik tidak sesuai: ${publicKeyBytes ?? 0} byte.`,
  });

  const keyIdWellFormed =
    envelope.signingKeyId !== null &&
    envelope.signingKeyId.length > 0 &&
    envelope.signingKeyId.length <= ANCHOR_KEY_ID_MAX;
  checks.push({
    code: 'key_id',
    ok: keyIdWellFormed,
    detail: keyIdWellFormed
      ? 'Identitas kunci tercatat.'
      : 'Identitas kunci tidak valid.',
  });

  const trustedKey = trustedKeyFor(trusted, envelope.signingKeyId);
  const keyTrusted = trustedKey !== null && sameBase64(trustedKey, envelope.publicKeyBase64);
  checks.push({
    code: 'key_trusted',
    ok: keyTrusted,
    detail:
      trustedKey === null
        ? 'Kunci tidak ada di daftar kunci publik tepercaya.'
        : keyTrusted
          ? 'Kunci publik cocok dengan daftar tepercaya.'
          : 'Kunci publik berbeda dari yang tercatat untuk key id ini.',
  });

  return { signed: complete && signatureWellFormed, signatureWellFormed, keyTrusted, checks };
}

export function verifyAnchorEnvelope(input: AnchorVerificationInput): AnchorVerification {
  const checks: AnchorCheck[] = [];
  const warnings: string[] = [];

  const now = parseIso(input.now);
  checks.push({
    code: 'now_parsable',
    ok: now !== null,
    detail: now === null ? 'Waktu pemeriksaan tidak valid.' : 'Waktu pemeriksaan valid.',
  });

  const anchorDate = parseDate(input.envelope.anchorDate);
  checks.push({
    code: 'anchor_date',
    ok: anchorDate !== null,
    detail: anchorDate === null ? 'Tanggal anchor tidak valid.' : 'Tanggal anchor valid.',
  });

  const rootBytes = decodedByteLength(input.envelope.merkleRootBase64);
  const rootWellFormed = rootBytes === ANCHOR_ROOT_BYTES;
  checks.push({
    code: 'root_length',
    ok: rootWellFormed,
    detail: rootWellFormed
      ? 'Merkle root 32 byte.'
      : `Panjang Merkle root tidak sesuai: ${rootBytes ?? 0} byte.`,
  });

  const countOk =
    Number.isInteger(input.envelope.leafCount) && input.envelope.leafCount >= 0;
  checks.push({
    code: 'leaf_count',
    ok: countOk,
    detail: countOk ? 'Jumlah daun wajar.' : 'Jumlah daun tidak valid.',
  });

  const windowStart = parseIso(input.envelope.windowStart);
  const windowEnd = parseIso(input.envelope.windowEnd);
  const windowOk =
    windowStart !== null && windowEnd !== null && windowStart.getTime() < windowEnd.getTime();
  checks.push({
    code: 'window_order',
    ok: windowOk,
    detail: windowOk ? 'Jendela waktu berurutan.' : 'Jendela waktu tidak berurutan.',
  });

  const anchoredDateMatches =
    anchorDate !== null &&
    windowStart !== null &&
    windowStart.toISOString().slice(0, 10) === input.envelope.anchorDate;
  checks.push({
    code: 'window_matches_date',
    ok: anchoredDateMatches,
    detail: anchoredDateMatches
      ? 'Jendela dimulai pada tanggal yang dianchor.'
      : 'Jendela tidak dimulai pada tanggal yang dianchor.',
  });

  const signedAt = input.envelope.signedAt === null ? null : parseIso(input.envelope.signedAt);
  const signedAfterWindow =
    signedAt === null || windowEnd === null ? false : signedAt.getTime() >= windowEnd.getTime();
  checks.push({
    code: 'signed_after_window',
    ok: signedAt === null || signedAfterWindow,
    detail:
      signedAt === null
        ? 'Anchor tidak ditandatangani.'
        : signedAfterWindow
          ? 'Tanda tangan dibuat setelah jendela ditutup.'
          : 'Tanda tangan dibuat sebelum jendela ditutup.',
  });

  const notFuture =
    signedAt === null || now === null
      ? true
      : signedAt.getTime() <= now.getTime() + ANCHOR_CLOCK_SKEW_MS;
  checks.push({
    code: 'signed_not_future',
    ok: notFuture,
    detail: notFuture
      ? 'Waktu tanda tangan tidak melampaui jam sekarang.'
      : 'Waktu tanda tangan berada di masa depan.',
  });

  let rootMatches = true;
  if (input.recomputedRootBase64 !== undefined && input.recomputedRootBase64 !== null) {
    rootMatches = sameBase64(input.recomputedRootBase64, input.envelope.merkleRootBase64);
    checks.push({
      code: 'root_matches_recomputed',
      ok: rootMatches,
      detail: rootMatches
        ? 'Root yang diumumkan sama dengan hasil hitung ulang.'
        : 'Root yang diumumkan berbeda dari hasil hitung ulang.',
    });
  } else {
    warnings.push('root_not_recomputed');
  }

  if (input.recomputedLeafCount !== undefined && input.recomputedLeafCount !== null) {
    const countMatches = input.recomputedLeafCount === input.envelope.leafCount;
    checks.push({
      code: 'count_matches_recomputed',
      ok: countMatches,
      detail: countMatches
        ? 'Jumlah daun sama dengan hasil hitung ulang.'
        : 'Jumlah daun berbeda dari hasil hitung ulang.',
    });
    if (!countMatches) {
      rootMatches = false;
    }
  }

  const structure = signatureStructure(input.envelope, input.trustedPublicKeys);
  checks.push(...structure.checks);

  if (
    input.envelope.signingKeyId !== null &&
    trustedKeyFor(input.trustedPublicKeys, input.envelope.signingKeyId) === null
  ) {
    warnings.push('untrusted_key');
  }
  if (!structure.signed) {
    warnings.push('anchor_unsigned');
  }
  if (signedAt === null) {
    warnings.push('signed_at_missing');
  }

  const status = resolveStatus({
    checks,
    signed: structure.signed,
    keyTrusted: structure.keyTrusted,
    rootMatches,
  });

  return {
    status,
    signed: structure.signed,
    signatureWellFormed: structure.signatureWellFormed,
    keyTrusted: structure.keyTrusted,
    rootMatches,
    checks,
    warnings,
  };
}

function resolveStatus(input: {
  checks: readonly AnchorCheck[];
  signed: boolean;
  keyTrusted: boolean;
  rootMatches: boolean;
}): AnchorStatus {
  const failed = new Set(
    input.checks.filter((check) => !check.ok).map((check) => check.code),
  );
  if (
    failed.has('now_parsable') ||
    failed.has('anchor_date') ||
    failed.has('root_length') ||
    failed.has('leaf_count')
  ) {
    return 'structural_invalid';
  }
  if (failed.has('root_matches_recomputed') || failed.has('count_matches_recomputed')) {
    return 'root_mismatch';
  }
  if (failed.has('signed_not_future')) {
    return 'future_dated';
  }
  if (failed.has('window_order') || failed.has('window_matches_date') || failed.has('signed_after_window')) {
    return 'window_inconsistent';
  }
  if (failed.has('signature_complete')) {
    return 'signature_missing';
  }
  if (failed.has('signature_length')) {
    return 'signature_invalid';
  }
  if (!input.keyTrusted) {
    return 'key_mismatch';
  }
  if (!input.signed) {
    return 'unsigned';
  }
  if (!input.rootMatches) {
    return 'root_mismatch';
  }
  return 'verified';
}

export function anchorIsVerified(verification: AnchorVerification): boolean {
  return verification.status === 'verified';
}

export interface AnchorGap {
  date: string;
  reason: 'missing' | 'unsigned' | 'unverified';
}

export interface AnchorTimelineEntry {
  date: string;
  status: AnchorStatus | 'missing';
}

export function timelineGaps(
  entries: readonly AnchorTimelineEntry[],
): readonly AnchorGap[] {
  const gaps: AnchorGap[] = [];
  for (const entry of entries) {
    if (entry.status === 'missing') {
      gaps.push({ date: entry.date, reason: 'missing' });
      continue;
    }
    if (entry.status !== 'verified') {
      gaps.push({
        date: entry.date,
        reason: entry.status === 'unsigned' || entry.status === 'signature_missing'
          ? 'unsigned'
          : 'unverified',
      });
    }
  }
  return gaps;
}

export function daySequence(startDate: string, endDate: string): readonly string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start === null || end === null || start.getTime() > end.getTime()) {
    return [];
  }
  const output: string[] = [];
  const cursor = new Date(start.getTime());
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 3_650) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return output;
}

export function anchorTrustCaveat(): string {
  return 'Anchor membuktikan integritas data terhadap root yang ditandatangani, bukan kebenaran isi laporan. Verifikasi hanya bermakna jika kunci publik diambil dari sumber di luar database aplikasi.';
}
