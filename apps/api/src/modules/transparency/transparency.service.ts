import { Inject, Injectable } from '@nestjs/common';
import type { AdminChainVerifyResult, TransparencyAnchor } from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { Transaction } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import {
  ChainRepository,
  inspectChain,
  type AnchorRow,
} from '../../db/repositories/chain.repository';
import { MERKLE_ALGORITHM, merkleSummary } from './merkle';

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

export function toTransparencyAnchor(row: AnchorRow): TransparencyAnchor {
  return {
    date: row.anchorDate,
    merkleRoot: row.merkleRoot.toString('base64'),
    eventCount: row.leafCount,
    txRef: row.txRef,
    verifyUrl: verifyUrlFor(row.anchorDate),
    publishedAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TransparencyService {
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
    if (sealed.created) {
      await this.audit.record({
        action: 'admin.anchor_sealed',
        objectType: 'anchor',
        objectId: date,
        actor: { kind: session.role, userId: session.adminId },
        requestId,
        payload: { leafCount: sealed.row.leafCount },
      });
    }
    return toTransparencyAnchor(sealed.row);
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
