import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { prefetchAll } from '../lib/prefetch';
import { methodologyQuery } from '../lib/queries';
import { formatDate, formatNumber } from '../lib/time';

function MethodologyPage() {
  const { data, isPending, isError, refetch } = useQuery(methodologyQuery());

  if (isPending) {
    return <StatePanel title="Memuat metodologi">Mengambil versi metode, langkah, dan batasannya.</StatePanel>;
  }

  if (isError || data === undefined) {
    return (
      <>
        <StatePanel tone="error" title="Metodologi tidak bisa dimuat">
          Versi metode tidak ditampilkan daripada menampilkan versi yang belum terverifikasi.
        </StatePanel>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void refetch();
            }}
          >
            Coba lagi
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <p className="label">Metode {data.methodVersion}</p>
        <h1 className="page-title">Cara angka ini dihitung</h1>
        <p className="page-lede">
          Diperbarui {formatDate(data.updatedAt)}. Angka tanpa jumlah sampel yang memadai tidak ditampilkan.
        </p>
      </div>

      <div className="prose">
        <h2>Yang diukur</h2>
        <p>{data.primaryEstimand}</p>
        <p>{data.secondaryEstimand}</p>

        <h2>Langkah</h2>
        <ol>
          {data.steps.map((step) => (
            <li key={step.order}>
              <strong>{step.title}.</strong> {step.detail}
            </li>
          ))}
        </ol>

        <h2>Klaster</h2>
        <p>{data.clusterRationale}</p>
        <p>Satuan klaster: {data.clusterUnit}.</p>

        <h2>Ambang</h2>
        <p>
          Kelebihan dihitung terhadap {formatNumber(data.thresholds.excessMultiplier, 2)} kali ambang, dengan
          tunggu ideal {data.thresholds.idealWaitFormula}.
        </p>

        <h2>Batas data</h2>
        <ul>
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

export const Route = createFileRoute('/metodologi')({
  loader: async ({ context }) => {
    await prefetchAll(context.queryClient.ensureQueryData(methodologyQuery()));
  },
  component: MethodologyPage,
});