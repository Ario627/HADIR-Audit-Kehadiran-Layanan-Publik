import type { EstimateStatus } from '../../lib/estimate';
import { formatDate } from '../../lib/time';

export interface EvidenceStampProps {
  status: EstimateStatus;
  n: number;
  computedAt: string;
}

export function EvidenceStamp({ status, n, computedAt }: EvidenceStampProps) {
  return (
    <p className="stamp" data-kind={status.key}>
      <strong>{status.label}</strong>
      <span>
        n={n} · {formatDate(computedAt)}
      </span>
      <span className="visually-hidden">{status.detail}</span>
    </p>
  );
}