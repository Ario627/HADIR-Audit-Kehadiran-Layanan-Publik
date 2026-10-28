import type { Estimate } from '@hadir/contracts';
import {
  ciText,
  compareToPromise,
  estimateReadout,
  estimateStatus,
  gapText,
  medianText,
  sampleText,
  windowLabel,
} from '../../lib/estimate';
import { formatDateTime } from '../../lib/time';
import { EvidenceStamp } from './EvidenceStamp';
import { EstimateFacts } from './EstimateFacts';
import { PromiseRow } from './PromiseRow';
import { WarningList } from './WarningList';

export interface EstimateBlockProps {
  estimate: Estimate;
  simulatedHint: boolean;
}

function MeasuredValue({ estimate }: { estimate: Estimate }) {
  const readout = estimateReadout(estimate);
  const interval = ciText(readout);
  const comparison = compareToPromise(estimate);

  return (
    <div className="measured">
      <p className="measured-value">
        <span className="measured-number">{medianText(readout)}</span>
        <span className="measured-unit">menit</span>
      </p>
      <p className="measured-meta">
        {interval === null ? 'Interval kepercayaan tidak tersedia' : interval}
      </p>
      <p className="measured-meta">
        {sampleText(estimate.metrics, estimate.sample.days, estimate.sample.devices)}
      </p>
      {comparison === null ? null : <p className="measured-meta">{gapText(comparison)}</p>}
    </div>
  );
}

function InsufficientValue({ estimate }: { estimate: Estimate }) {
  const readout = estimateReadout(estimate);
  return (
    <div className="measured">
      <p className="measured-value">
        <span className="measured-number">—</span>
        <span className="measured-unit">menit</span>
      </p>
      <p className="measured-meta">
        {readout.kind === 'empty'
          ? 'Belum ada catatan yang layak pada jendela ini.'
          : `Baru ${readout.n} catatan, di bawah ambang minimum.`}
      </p>
      <p className="measured-meta">Jadi yang pertama mencatat di halte ini.</p>
    </div>
  );
}

export function EstimateBlock({ estimate, simulatedHint }: EstimateBlockProps) {
  const readout = estimateReadout(estimate);
  const status = estimateStatus(estimate.evidence, estimate.direction);
  const measured = readout.kind === 'measured';

  return (
    <section className="estimate" aria-labelledby="estimate-heading">
      <div className="estimate-head">
        <h2 id="estimate-heading" className="label">
          Estimasi tunggu · {windowLabel(estimate.window.label)}
        </h2>
        {estimate.simulated || simulatedHint ? <span className="tag tag--demo">Simulasi</span> : null}
      </div>

      <PromiseRow promise={estimate.promise} />
      <div className="platform-line" aria-hidden="true" />

      <div className="estimate-body">
        {measured ? <MeasuredValue estimate={estimate} /> : <InsufficientValue estimate={estimate} />}
        <EvidenceStamp status={status} n={estimate.metrics.n} computedAt={estimate.computedAt} />
      </div>

      <p className="estimate-message">{estimate.message}</p>
      <WarningList codes={estimate.warnings} />

      <p className="estimate-asof">
        Dihitung {formatDateTime(estimate.computedAt)} · metode {estimate.methodVersion}
      </p>

      {measured ? <EstimateFacts estimate={estimate} /> : null}
    </section>
  );
}