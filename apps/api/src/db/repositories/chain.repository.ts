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

export interface AnchorRow {
  anchorDate: string;
  merkleRoot: Buffer;
  leafCount: number;
  windowStart: Date;
  windowEnd: Date;
  txRef: string | null;
  proof: Record<string, unknown>;
  createdAt: Date;
}

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

  async findAnchor(
    executor: Database | Transaction,
    anchorDate: string,
  ): Promise<AnchorRow | null> {
    const result = await executor.execute(sql`
      SELECT anchor_date::text AS anchor_date, merkle_root, leaf_count,
             window_start, window_end, tx_ref, proof, created_at
      FROM anchor_log
      WHERE anchor_date = ${anchorDate}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
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
    };
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
      RETURNING anchor_date::text AS anchor_date, merkle_root, leaf_count,
                window_start, window_end, tx_ref, proof, created_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
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
    };
  }
}
