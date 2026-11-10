import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { DATABASE } from '../../db/db.module';
import type { ChainBreak } from '@hadir/contracts';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../common/utils/canonical-json';

const GENESIS = Buffer.alloc(32);

export interface StoredEvent {
  reportId: string;
  publicId: string;
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  prevHash: Buffer;
  payloadHash: Buffer;
  chainHash: Buffer;
  createdAt: Date;
}

export interface AnchorSignatureRow {
  signature: Buffer | null;
  signatureAlgorithm: string | null;
  signingKeyId: string | null;
  publicKey: Buffer | null;
  signedAt: Date | null;
}

export interface AnchorRow extends AnchorSignatureRow {
  anchorDate: string;
  merkleRoot: Buffer;
  leafCount: number;
  windowStart: Date;
  windowEnd: Date;
  txRef: string | null;
  proof: Record<string, unknown>;
  createdAt: Date;
}

export interface AnchorSignatureInput {
  signature: Buffer;
  signatureAlgorithm: string;
  signingKeyId: string;
  publicKey: Buffer;
  signedAt: Date;
}

const ANCHOR_COLUMNS = sql`
  anchor_date::text AS anchor_date, merkle_root, leaf_count,
  window_start, window_end, tx_ref, proof, created_at,
  signature, signature_algorithm, signing_key_id, public_key, signed_at
`;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error('Kolom waktu tidak valid.');
}

function asBuffer(value: unknown, field: string): Buffer {
  if (value instanceof Buffer) {
    return value;
  }
  throw new Error(`Kolom ${field} bukan bytea.`);
}

function asNullableBuffer(value: unknown): Buffer | null {
  return value instanceof Buffer ? value : null;
}

function toAnchor(row: Record<string, unknown>): AnchorRow {
  const proof = row.proof;
  return {
    anchorDate: asString(row.anchor_date, 'anchor_date'),
    merkleRoot: asBuffer(row.merkle_root, 'merkle_root'),
    leafCount: Number(row.leaf_count ?? 0),
    windowStart: asDate(row.window_start),
    windowEnd: asDate(row.window_end),
    txRef: typeof row.tx_ref === 'string' ? row.tx_ref : null,
    proof:
      proof !== null && typeof proof === 'object' && !Array.isArray(proof)
        ? (proof as Record<string, unknown>)
        : {},
    createdAt: asDate(row.created_at),
    signature: asNullableBuffer(row.signature),
    signatureAlgorithm:
      typeof row.signature_algorithm === 'string' ? row.signature_algorithm : null,
    signingKeyId: typeof row.signing_key_id === 'string' ? row.signing_key_id : null,
    publicKey: asNullableBuffer(row.public_key),
    signedAt: row.signed_at === null || row.signed_at === undefined ? null : asDate(row.signed_at),
  };
}

function toEvent(row: Record<string, unknown>): StoredEvent {
  const payload = row.payload;
  return {
    reportId: asString(row.report_id, 'report_id'),
    publicId: asString(row.public_id, 'public_id'),
    seq: Number(row.seq ?? 0),
    kind: asString(row.kind, 'kind'),
    payload:
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {},
    prevHash: asBuffer(row.prev_hash, 'prev_hash'),
    payloadHash: asBuffer(row.payload_hash, 'payload_hash'),
    chainHash: asBuffer(row.chain_hash, 'chain_hash'),
    createdAt: asDate(row.created_at),
  };
}

export function payloadHashOf(payload: Record<string, unknown>): Buffer {
  return createHash('sha256').update(canonicalJson(payload)).digest();
}

export function chainHashOf(previous: Buffer, payloadHash: Buffer): Buffer {
  return createHash('sha256').update(previous).update(payloadHash).digest();
}

export function inspectChain(events: readonly StoredEvent[]): ChainBreak[] {
  const breaks: ChainBreak[] = [];
  let expectedSeq = 1;
  let previous: Buffer = GENESIS;
  for (const event of events) {
    if (event.seq !== expectedSeq) {
      breaks.push({
        reportPublicId: event.publicId,
        seq: event.seq,
        kind: event.kind,
        reason: 'gap',
      });
    }
    if (!event.prevHash.equals(previous)) {
      breaks.push({
        reportPublicId: event.publicId,
        seq: event.seq,
        kind: event.kind,
        reason: 'prev_mismatch',
      });
    }
    const recomputedPayload = payloadHashOf(event.payload);
    if (!recomputedPayload.equals(event.payloadHash)) {
      breaks.push({
        reportPublicId: event.publicId,
        seq: event.seq,
        kind: event.kind,
        reason: 'payload_mismatch',
      });
    }
    const recomputedChain = chainHashOf(event.prevHash, recomputedPayload);
    if (!recomputedChain.equals(event.chainHash)) {
      breaks.push({
        reportPublicId: event.publicId,
        seq: event.seq,
        kind: event.kind,
        reason: 'chain_mismatch',
      });
    }
    previous = event.chainHash;
    expectedSeq = event.seq + 1;
  }
  return breaks;
}

@Injectable()
export class ChainRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listReportIds(
    executor: Database | Transaction,
    limit: number,
  ): Promise<string[]> {
    const result = await executor.execute(sql`
      SELECT DISTINCT report_id
      FROM report_events
      ORDER BY report_id
      LIMIT ${limit}
    `);
    return result.rows.map((row) =>
      asString((row as Record<string, unknown>).report_id, 'report_id'),
    );
  }

  async listEventsForReport(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<StoredEvent[]> {
    const result = await executor.execute(sql`
      SELECT e.report_id, r.public_id, e.seq, e.kind, e.payload,
             e.prev_hash, e.payload_hash, e.chain_hash, e.created_at
      FROM report_events e
      JOIN reports r ON r.id = e.report_id
      WHERE e.report_id = ${reportId}
      ORDER BY e.seq ASC
    `);
    return result.rows.map((row) => toEvent(row as Record<string, unknown>));
  }

  async findReportIdByPublicId(
    executor: Database | Transaction,
    publicId: string,
  ): Promise<string | null> {
    const result = await executor.execute(sql`
      SELECT id FROM reports WHERE public_id = ${publicId} LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : asString(row.id, 'id');
  }

  async listChainHashesInWindow(
    executor: Database | Transaction,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Buffer[]> {
    const result = await executor.execute(sql`
      SELECT chain_hash
      FROM report_events
      WHERE created_at >= ${windowStart} AND created_at < ${windowEnd}
      ORDER BY created_at ASC, report_id ASC, seq ASC
    `);
    return result.rows.map((row) =>
      asBuffer((row as Record<string, unknown>).chain_hash, 'chain_hash'),
    );
  }

  async listChainLeavesInWindow(
    executor: Database | Transaction,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ chainHash: Buffer; reportId: string; seq: number }[]> {
    const result = await executor.execute(sql`
      SELECT chain_hash, report_id, seq
      FROM report_events
      WHERE created_at >= ${windowStart} AND created_at < ${windowEnd}
      ORDER BY created_at ASC, report_id ASC, seq ASC
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        chainHash: asBuffer(record.chain_hash, 'chain_hash'),
        reportId: asString(record.report_id, 'report_id'),
        seq: Number(record.seq ?? 0),
      };
    });
  }

  async listPublicKeyUsage(
    executor: Database | Transaction,
  ): Promise<
    { keyId: string; publicKey: Buffer; firstDate: string; lastDate: string; count: number }[]
  > {
    const result = await executor.execute(sql`
      SELECT signing_key_id, public_key,
             min(anchor_date)::text AS first_date,
             max(anchor_date)::text AS last_date,
             count(*)::int AS total
      FROM anchor_log
      WHERE signing_key_id IS NOT NULL AND public_key IS NOT NULL
      GROUP BY signing_key_id, public_key
      ORDER BY max(anchor_date) DESC
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        keyId: asString(record.signing_key_id, 'signing_key_id'),
        publicKey: asBuffer(record.public_key, 'public_key'),
        firstDate: asString(record.first_date, 'first_date'),
        lastDate: asString(record.last_date, 'last_date'),
        count: Number(record.total ?? 0),
      };
    });
  }

  async findAnchor(
    executor: Database | Transaction,
    anchorDate: string,
  ): Promise<AnchorRow | null> {
    const result = await executor.execute(sql`
      SELECT ${ANCHOR_COLUMNS}
      FROM anchor_log
      WHERE anchor_date = ${anchorDate}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toAnchor(row);
  }

  async listAnchorsBetween(
    executor: Database | Transaction,
    fromDate: string,
    toDate: string,
  ): Promise<AnchorRow[]> {
    const result = await executor.execute(sql`
      SELECT ${ANCHOR_COLUMNS}
      FROM anchor_log
      WHERE anchor_date >= ${fromDate}::date AND anchor_date <= ${toDate}::date
      ORDER BY anchor_date ASC
    `);
    return result.rows.map((row) => toAnchor(row as Record<string, unknown>));
  }

  async findLatestAnchor(
    executor: Database | Transaction,
  ): Promise<AnchorRow | null> {
    const result = await executor.execute(sql`
      SELECT ${ANCHOR_COLUMNS}
      FROM anchor_log
      ORDER BY anchor_date DESC
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toAnchor(row);
  }

  async attachSignature(
    tx: Transaction,
    anchorDate: string,
    input: AnchorSignatureInput,
  ): Promise<AnchorRow | null> {
    const result = await tx.execute(sql`
      UPDATE anchor_log
      SET signature = ${input.signature},
          signature_algorithm = ${input.signatureAlgorithm},
          signing_key_id = ${input.signingKeyId},
          public_key = ${input.publicKey},
          signed_at = ${input.signedAt}
      WHERE anchor_date = ${anchorDate} AND signature IS NULL
      RETURNING ${ANCHOR_COLUMNS}
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toAnchor(row);
  }

  async insertAnchor(
    tx: Transaction,
    input: {
      anchorDate: string;
      merkleRoot: Buffer;
      leafCount: number;
      windowStart: Date;
      windowEnd: Date;
      proof: Record<string, unknown>;
    },
  ): Promise<AnchorRow | null> {
    const result = await tx.execute(sql`
      INSERT INTO anchor_log (
        anchor_date, merkle_root, leaf_count, window_start, window_end, proof
      ) VALUES (
        ${input.anchorDate}, ${input.merkleRoot}, ${input.leafCount},
        ${input.windowStart}, ${input.windowEnd}, ${JSON.stringify(input.proof)}::jsonb
      )
      ON CONFLICT (anchor_date) DO NOTHING
      RETURNING ${ANCHOR_COLUMNS}
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toAnchor(row);
  }
}
