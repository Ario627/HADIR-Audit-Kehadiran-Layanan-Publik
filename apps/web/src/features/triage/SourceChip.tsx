import type { SourceTier } from '@hadir/contracts';
import { tierLabel } from '../../lib/triage';

export interface SourceChipProps {
  tier: SourceTier;
}

export function SourceChip({ tier }: SourceChipProps) {
  return (
    <span className="source-chip" data-tier={tier}>
      <span className="source-tier">{tier}</span>
      <span className="source-label">{tierLabel(tier)}</span>
    </span>
  );
}