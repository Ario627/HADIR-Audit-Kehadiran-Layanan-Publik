import type { Estimate } from '@hadir/contracts';
import { formatMinuteValue, rateText } from '../../lib/estimate';

export interface EstimateFactsProps {
  estimate: Estimate;
}

export function EstimateFacts({ estimate }: EstimateFactsProps) {
  const { metrics, sample, thresholdMin } = {
    metrics: estimate.metrics,
    sample: estimate.sample,
    thresholdMin: estimate.sample.thresholdMin,
  };

  return (
    <details className="facts">
      <summary>Rincian angka</summary>
      <dl>
        <div>
          <dt>Median</dt>
          <dd>{formatMinuteValue(metrics.medianMin)} mnt</dd>
        </div>
        <div>
          <dt>Rata-rata</dt>
          <dd>{formatMinuteValue(metrics.meanMin)} mnt</dd>
        </div>
        <div>
          <dt>RMST (batas analisis)</dt>
          <dd>{formatMinuteValue(metrics.rmstMin)} mnt</dd>
        </div>
        <div>
          <dt>Persentil 95</dt>
          <dd>{formatMinuteValue(metrics.p95Min)} mnt</dd>
        </div>
        <div>
          <dt>Kelebihan atas tunggu ideal</dt>
          <dd>{formatMinuteValue(metrics.ewtMin)} mnt</dd>
        </div>
        <div>
          <dt>Berhenti menunggu</dt>
          <dd>{rateText(metrics.abandonRate)}</dd>
        </div>
        <div>
          <dt>Bus penuh</dt>
          <dd>{rateText(metrics.fullRate)}</dd>
        </div>
        <div>
          <dt>RMST sampai naik</dt>
          <dd>{formatMinuteValue(metrics.timeToBoardRmstMin)} mnt</dd>
        </div>
        <div>
          <dt>Ambang kelebihan</dt>
          <dd>{thresholdMin === null ? '—' : `${formatMinuteValue(thresholdMin)} mnt`}</dd>
        </div>
        <div>
          <dt>N efektif</dt>
          <dd>{formatMinuteValue(metrics.nEffective)}</dd>
        </div>
        <div>
          <dt>Klaster</dt>
          <dd>{sample.clusters}</dd>
        </div>
        <div>
          <dt>Design effect</dt>
          <dd>{formatMinuteValue(sample.designEffect)}</dd>
        </div>
      </dl>
      <p className="facts-foot">
        Metode {estimate.methodVersion} · dihitung {estimate.computedAt}
      </p>
    </details>
  );
}