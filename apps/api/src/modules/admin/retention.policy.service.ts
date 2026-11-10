import { Injectable } from '@nestjs/common';
import type { RetentionPlan } from '@hadir/domain';
import { actionableDecisions, describeRetention } from '@hadir/domain';
import { RetentionRepository } from '../../db/repositories/retention.repository';
import type { RetentionOutcome, RetentionRunRow } from '../../db/repositories/retention.repository';

export interface RetentionReport {
  plan: RetentionPlan;
  description: readonly string[];
  actionable: number;
  protectedCount: number;
}

@Injectable()
export class RetentionPolicyService {
  constructor(private readonly repository: RetentionRepository) {}

  async report(now: Date = new Date()): Promise<RetentionReport> {
    const plan = await this.repository.plan(now);
    return {
      plan,
      description: describeRetention(plan),
      actionable: actionableDecisions(plan).length,
      protectedCount: plan.skipped.length,
    };
  }

  async run(now: Date = new Date()): Promise<RetentionOutcome> {
    const plan = await this.repository.plan(now);
    return this.repository.runPlan(plan, 'manual');
  }

  async recentRuns(limit: number): Promise<RetentionRunRow[]> {
    return this.repository.recentRuns(limit);
  }
}
