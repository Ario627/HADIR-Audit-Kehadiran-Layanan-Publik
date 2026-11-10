import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AdminChainVerifyResult,
  AnchorInclusionProof,
  AnchorPublicKey,
  AnchorTimeline,
  AnchorTimelineQuery,
  TransparencyAnchor,
} from '@hadir/contracts';
import {
  ANCHOR_ALGORITHM,
  anchorTrustCaveat,
  canonicalAnchorPayload,
  daySequence,
  timelineGaps,
  type AnchorEnvelope,
} from '@hadir/domain';
import { AuditService } from '../../common/audit/audit.service';
import { env } from '../../common/config/env';
import { anchorSignedParts, requireAnchorSigner } from '../../common/crypto/anchor-signer';
import { AppError } from '../../common/errors/app-error';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { Transaction } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import {
  ChainRepository,
  inspectChain,
  type AnchorRow,
} from '../../db/repositories/chain.repository';
import {
  MERKLE_ALGORITHM,
  merkleProof,
  merkleSummary,
  verifyMerkleProof,
} from './merkle';

const DAY_MS = 86_400_000;
const MAX_BREAKS = 500;

export function dayWindow(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Tanggal anchor tidak valid.',
      errors: [
        { field: 'date', code: 'invalid_date', message: 'Format tanggal harus YYYY-MM-DD.' },
      ],
    });
  }
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function verifyUrlFor(date: string): string {
  const base = env.webOrigins[0] ?? 'https://hadir.id';
  return `${base}/transparansi/${date}`;
}

export function envelopeOf(row: AnchorRow): AnchorEnvelope {
  return {
    anchorDate: row.anchorDate,
    merkleRootBase64: row.merkleRoot.toString('base64'),
    leafCount: row.leafCount,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    signingKeyId: row.signingKeyId,
    signatureAlgorithm: row.signatureAlgorithm,
    signatureBase64: row.signature === null ? null : row.signature.toString('base64'),
    publicKeyBase64: row.publicKey === null ? null : row.publicKey.toString('base64'),
    signedAt: row.signedAt === null ? null : row.signedAt.toISOString(),
  };
}

export function payloadDigestOf(row: AnchorRow): string {
  return createHash('sha256')
    .update(canonicalAnchorPayload(envelopeOf(row)), 'utf8')
    .digest('base64');
}

export function toTransparencyAnchor(row: AnchorRow): TransparencyAnchor {
  const signature =
    row.signature !== null &&
    row.signingKeyId !== null &&
    row.publicKey !== null &&
    row.signedAt !== null &&
    row.signatureAlgorithm === ANCHOR_ALGORITHM
      ? {
          algorithm: 'ed25519' as const,
          keyId: row.signingKeyId,
          signature: row.signature.toString('base64'),
          publicKey: row.publicKey.toString('base64'),
          signedAt: row.signedAt.toISOString(),
        }
      : null;
  return {
    date: row.anchorDate,
    merkleRoot: row.merkleRoot.toString('base64'),
    eventCount: row.leafCount,
    txRef: row.txRef,
    verifyUrl: verifyUrlFor(row.anchorDate),
    publishedAt: row.createdAt.toISOString(),
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    signature,
    payloadDigest: payloadDigestOf(row),
    caveat: anchorTrustCaveat(),
  };
}

@Injectable()
export class TransparencyService {
  private readonly logger = new Logger(TransparencyService.name);

  constructor(
    private readonly chain: ChainRepository,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  async readAnchor(date: string): Promise<TransparencyAnchor> {
    const { start } = dayWindow(date);
    const row = await this.run((tx) => this.chain.findAnchor(tx, date), {
      scope: 'public',
      requestId: `anchor-read-${start.getTime()}`,
    });
    if (row === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Anchor untuk tanggal tersebut belum diterbitkan.',
      });
    }
    return toTransparencyAnchor(row);
  }

  async seal(
    date: string,
    session: PlatformAdminSession,
    requestId: string,
    now: Date = new Date(),
  ): Promise<TransparencyAnchor> {
    const { start, end } = dayWindow(date);
    if (end.getTime() > now.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Anchor hanya bisa diterbitkan untuk hari yang sudah selesai.',
        errors: [
          {
            field: 'date',
            code: 'window_open',
            message: 'Tunggu hingga hari tersebut berakhir (UTC).',
          },
        ],
      });
    }

    const sealed = await this.run(
      async (tx) => {
        const existing = await this.chain.findAnchor(tx, date);
        if (existing !== null) {
          return { row: existing, created: false };
        }
        const leaves = await this.chain.listChainHashesInWindow(tx, start, end);
        if (leaves.length === 0) {
          return { row: null, created: false };
        }
        const summary = merkleSummary(leaves);
        const row = await this.chain.insertAnchor(tx, {
          anchorDate: date,
          merkleRoot: summary.root,
          leafCount: leaves.length,
          windowStart: start,
          windowEnd: end,
          proof: {
            algorithm: MERKLE_ALGORITHM,
            levels: summary.levels,
            leavesDigest: summary.leavesDigest.toString('hex'),
          },
        });
        return { row, created: row !== null };
      },
      { scope: 'admin', requestId, userId: session.adminId },
    );

    if (sealed.row === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Tidak ada event untuk di-anchor pada tanggal tersebut.',
      });
    }

    const signed = await this.signRow(sealed.row, session, requestId, now);

    if (sealed.created) {
      await this.audit.record({
        action: 'admin.anchor_sealed',
        objectType: 'anchor',
        objectId: date,
        actor: { kind: session.role, userId: session.adminId },
        requestId,
        payload: {
          leafCount: signed.leafCount,
          signed: signed.signature !== null,
          keyId: signed.signingKeyId,
        },
      });
    }
    return toTransparencyAnchor(signed);
  }

  private async signRow(
    row: AnchorRow,
    session: PlatformAdminSession,
    requestId: string,
    now: Date,
  ): Promise<AnchorRow> {
    if (row.signature !== null) {
      return row;
    }
    if (env.anchorSigningKey === null || env.anchorSigningKeyId === null) {
      this.logger.warn(
        `Anchor ${row.anchorDate} disimpan tanpa tanda tangan: ANCHOR_SIGNING_KEY belum dikonfigurasi.`,
      );
      return row;
    }
    const signer = requireAnchorSigner(env.anchorSigningKey, env.anchorSigningKeyId);
    const parts = anchorSignedParts(signer, envelopeOf(row), now);
    const updated = await this.run(
      (tx) =>
        this.chain.attachSignature(tx, row.anchorDate, {
          signature: Buffer.from(parts.signatureBase64, 'base64'),
          signatureAlgorithm: parts.signatureAlgorithm,
          signingKeyId: parts.signingKeyId,
          publicKey: Buffer.from(parts.publicKeyBase64, 'base64'),
          signedAt: parts.signedAt,
        }),
      { scope: 'admin', requestId, userId: session.adminId },
    );
    if (updated === null) {
      const current = await this.run((tx) => this.chain.findAnchor(tx, row.anchorDate), {
        scope: 'admin',
        requestId,
        userId: session.adminId,
      });
      return current ?? row;
    }
    return updated;
  }

  async publicKeys(): Promise<{ items: AnchorPublicKey[] }> {
    const rows = await this.run((tx) => this.chain.listPublicKeyUsage(tx), {
      scope: 'public',
      requestId: 'anchor-keys',
    });
    return {
      items: rows.map((row) => ({
        algorithm: ANCHOR_ALGORITHM,
        keyId: row.keyId,
        publicKey: row.publicKey.toString('base64'),
        firstAnchoredAt: `${row.firstDate}T00:00:00.000Z`,
        lastAnchoredAt: `${row.lastDate}T00:00:00.000Z`,
        anchorCount: row.count,
      })),
    };
  }

  async timeline(query: AnchorTimelineQuery, now: Date = new Date()): Promise<AnchorTimeline> {
    const to = query.to ?? now.toISOString().slice(0, 10);
    const from =
      query.from ??
      new Date(new Date(`${to}T00:00:00.000Z`).getTime() - (query.days - 1) * DAY_MS)
        .toISOString()
        .slice(0, 10);
    const dates = daySequence(from, to);
    if (dates.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Rentang tanggal tidak valid.',
        errors: [
          { field: 'from', code: 'invalid_range', message: 'from harus sebelum to.' },
        ],
      });
    }
    const rows = await this.run((tx) => this.chain.listAnchorsBetween(tx, from, to), {
      scope: 'public',
      requestId: 'anchor-timeline',
    });
    const byDate = new Map(rows.map((row) => [row.anchorDate, row]));
    const entries = dates.map((date) => {
      const row = byDate.get(date);
      if (row === undefined) {
        return {
          date,
          status: 'missing' as const,
          eventCount: null,
          signed: false,
        };
      }
      const signed =
        row.signature !== null && row.signingKeyId !== null && row.signatureAlgorithm === ANCHOR_ALGORITHM;
      return {
        date,
        status: signed ? ('verified' as const) : ('unsigned' as const),
        eventCount: row.leafCount,
        signed,
      };
    });
    const gaps = [...timelineGaps(entries)];
    return { from, to, entries, gaps, complete: gaps.length === 0 };
  }

  async inclusionProof(
    publicId: string,
    seq: number | null,
  ): Promise<AnchorInclusionProof> {
    const events = await this.run(
      async (tx) => {
        const reportId = await this.chain.findReportIdByPublicId(tx, publicId);
        if (reportId === null) {
          return null;
        }
        const all = await this.chain.listEventsForReport(tx, reportId);
        return all.length === 0 ? null : all;
      },
      { scope: 'public', requestId: `anchor-proof-${publicId}` },
    );
    if (events === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }

    const target =
      seq === null ? events[events.length - 1]! : events.find((event) => event.seq === seq);
    if (target === undefined) {
      throw new AppError('NOT_FOUND', { detail: 'Event tidak ditemukan pada laporan ini.' });
    }

    const date = target.createdAt.toISOString().slice(0, 10);
    const { start, end } = dayWindow(date);
    const anchor = await this.run((tx) => this.chain.findAnchor(tx, date), {
      scope: 'public',
      requestId: `anchor-proof-${date}`,
    });
    if (anchor === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Anchor untuk tanggal event tersebut belum diterbitkan.',
      });
    }

    const leaves = await this.run((tx) => this.chain.listChainLeavesInWindow(tx, start, end), {
      scope: 'public',
      requestId: `anchor-proof-${date}`,
    });
    const index = leaves.findIndex(
      (leaf) => leaf.reportId === target.reportId && leaf.seq === target.seq,
    );
    if (index < 0) {
      throw new AppError('NOT_FOUND', { detail: 'Event tidak termasuk dalam anchor hari itu.' });
    }

    const hashes = leaves.map((leaf) => leaf.chainHash);
    const proof = merkleProof(hashes, index);
    const verified = hashes.length === anchor.leafCount && verifyMerkleProof(
      hashes[index]!,
      proof,
      index,
      anchor.merkleRoot,
    );

    return {
      date,
      reportPublicId: publicId,
      seq: target.seq,
      leaf: hashes[index]!.toString('base64'),
      index,
      proof: proof.map((node) => node.toString('base64')),
      root: anchor.merkleRoot.toString('base64'),
      verified,
    };
  }

  async verify(
    input: { since?: string | undefined; until?: string | undefined; maxReports: number },
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<AdminChainVerifyResult> {
    const breaks: AdminChainVerifyResult['breaks'] = [];
    let checkedEvents = 0;

    const reportIds = await this.run(
      (tx) => this.chain.listReportIds(tx, input.maxReports),
      { scope: 'admin', requestId, userId: session.adminId },
    );

    for (const reportId of reportIds) {
      const events = await this.run(
        (tx) => this.chain.listEventsForReport(tx, reportId),
        { scope: 'admin', requestId, userId: session.adminId },
      );
      const filtered = events.filter((event) => {
        if (input.since !== undefined && event.createdAt < new Date(input.since)) {
          return false;
        }
        if (input.until !== undefined && event.createdAt > new Date(input.until)) {
          return false;
        }
        return true;
      });
      checkedEvents += filtered.length;
      for (const broken of inspectChain(filtered)) {
        if (breaks.length < MAX_BREAKS) {
          breaks.push(broken);
        }
      }
    }

    const result: AdminChainVerifyResult = {
      checkedReports: reportIds.length,
      checkedEvents,
      breaks,
      ok: breaks.length === 0,
    };

    await this.audit.record({
      action: 'admin.chain_verify',
      objectType: 'system',
      objectId: null,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: {
        checkedReports: result.checkedReports,
        checkedEvents: result.checkedEvents,
        breakCount: breaks.length,
      },
    });

    return result;
  }

  async sealWithin(
    tx: Transaction,
    date: string,
    now: Date,
  ): Promise<AnchorRow | null> {
    const { start, end } = dayWindow(date);
    if (end.getTime() > now.getTime()) {
      return null;
    }
    const leaves = await this.chain.listChainHashesInWindow(tx, start, end);
    if (leaves.length === 0) {
      return null;
    }
    const summary = merkleSummary(leaves);
    return this.chain.insertAnchor(tx, {
      anchorDate: date,
      merkleRoot: summary.root,
      leafCount: leaves.length,
      windowStart: start,
      windowEnd: end,
      proof: {
        algorithm: MERKLE_ALGORITHM,
        levels: summary.levels,
        leavesDigest: summary.leavesDigest.toString('hex'),
      },
    });
  }
}
