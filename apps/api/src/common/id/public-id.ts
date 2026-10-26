import { sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';

const PUBLIC_ID_SPACE = 1_000_000n;
const PUBLIC_ID_MULTIPLIER = 7_919n;
const PUBLIC_ID_WIDTH = 6;
const MAX_SEQUENCE = 999_999n;

export interface PublicIdParts {
  year: number;
  number: number;
}

function permute(sequence: bigint): bigint {
  return (sequence * PUBLIC_ID_MULTIPLIER) % PUBLIC_ID_SPACE;
}

export function formatPublicId(parts: PublicIdParts): string {
  const padded = parts.number.toString().padStart(PUBLIC_ID_WIDTH, '0');
  return `LPR-${parts.year}-${padded}`;
}

export function publicIdNumber(sequence: bigint): number {
  if (sequence <= 0n || sequence > MAX_SEQUENCE) {
    throw new Error(
      `Urutan laporan ${sequence} di luar rentang; perlu migrasi ruang ID baru.`,
    );
  }
  return Number(permute(sequence));
}

export async function nextPublicId(tx: Transaction, now: Date): Promise<string> {
  const result = await tx.execute(sql`SELECT nextval('reports_public_seq')::text AS value`);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const raw = typeof row.value === 'string' ? row.value : null;
  if (raw === null) {
    throw new Error('Urutan ID laporan tidak tersedia.');
  }
  return formatPublicId({
    year: now.getUTCFullYear(),
    number: publicIdNumber(BigInt(raw)),
  });
}
