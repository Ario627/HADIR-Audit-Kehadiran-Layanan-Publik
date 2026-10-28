import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { describeError } from '../lib/errors';
import { prefetchAll } from '../lib/prefetch';
import {
  clearLocalData,
  inventorySummary,
  NOT_COLLECTED,
  PRIVACY_PRINCIPLES,
  readLocalInventory,
} from '../lib/privacy';
import { myReportsQuery } from '../lib/queries';
import { categoryLabel, statusLabel } from '../lib/report';
import { formatDate } from '../lib/time';

function MyReports() {
  const [inventory] = useState(() => readLocalInventory());
  const query = useQuery({
    ...myReportsQuery(),
    enabled: inventory.reportIds.length > 0,
  });

  if (inventory.reportIds.length === 0) {
    return (
      <p className="note">
        Belum ada nomor laporan tersimpan di perangkat ini. Nomor laporan hanya tersimpan setelah kamu
        mengirim laporan dari perangkat ini.
      </p>
    );
  }

  if (query.isPending) {
    return <StatePanel title="Memuat laporan">Mengambil laporan yang dibuat dari perangkat ini.</StatePanel>;
  }

  if (query.isError) {
    const message = describeError(query.error);
    return (
      <StatePanel tone="error" title={message.title}>
        {message.detail}
      </StatePanel>
    );
  }

  if (query.data.length === 0) {
    return (
      <p className="note">
        Nomor laporan tersimpan, tetapi server tidak mengembalikan laporan apa pun untuk perangkat ini.
      </p>
    );
  }

  return (
    <ul className="picker-results">
      {query.data.map((item) => (
        <li key={item.publicId}>
          <Link to="/laporan/$publicId" params={{ publicId: item.publicId }} className="picker-item">
            <span className="board-code">{item.publicId}</span>
            <span className="picker-name">{item.stopName}</span>
            <span className="board-meta">
              {categoryLabel(item.category)} · {statusLabel(item.status)} · {formatDate(item.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PrivacyPage() {
  const [inventory, setInventory] = useState(() => readLocalInventory());
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

  return (
    <>
      <div className="page-head">
        <p className="label">Privasi</p>
        <h1 className="page-title">Apa yang dicatat, dan apa yang tidak</h1>
        <p className="page-lede">
          Halaman ini menjelaskan data yang dipakai untuk mengukur waktu tunggu. Ringkasnya: waktu,
          halte, dan hasil pengukuran.
        </p>
      </div>

      <section className="privacy-block" aria-labelledby="principles-heading">
        <h2 className="label" id="principles-heading">
          Prinsip
        </h2>
        <dl className="ledger">
          {PRIVACY_PRINCIPLES.map((principle) => (
            <div key={principle.title}>
              <dt>{principle.title}</dt>
              <dd>
                <span className="ledger-note">{principle.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="privacy-block" aria-labelledby="not-collected-heading">
        <h2 className="label" id="not-collected-heading">
          Tidak dikumpulkan
        </h2>
        <ul className="warnings">
          {NOT_COLLECTED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy-block" aria-labelledby="local-heading">
        <h2 className="label" id="local-heading">
          Data di perangkat ini
        </h2>
        <p className="note">{inventorySummary(inventory)}</p>

        {cleared === null ? null : (
          <p className="report-action-note" role="status">
            {cleared}
          </p>
        )}

        {confirming ? (
          <div className="confirm">
            <p className="confirm-text" id="clear-question">
              Hapus catatan lokal di perangkat ini? Laporan yang sudah terkirim tetap ada di server,
              dan episode yang sedang berjalan tidak ikut dibatalkan.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn--danger"
                aria-describedby="clear-question"
                onClick={() => {
                  const result = clearLocalData();
                  setInventory(readLocalInventory());
                  setConfirming(false);
                  setCleared(
                    result.episodeRemoved || result.reportsRemoved > 0
                      ? 'Catatan lokal sudah dihapus.'
                      : 'Tidak ada catatan lokal yang perlu dihapus.',
                  );
                }}
              >
                Ya, hapus catatan lokal
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Batal
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Hapus catatan lokal
          </button>
        )}
      </section>

      <section className="privacy-block" aria-labelledby="reports-heading">
        <h2 className="label" id="reports-heading">
          Laporan dari perangkat ini
        </h2>
        <MyReports />
      </section>

      <p className="note">
        Penghapusan data di server, ekspor data, dan kontak pengawas belum tersedia di aplikasi ini.
        Sampaikan permintaan lewat kanal resmi yang tercantum pada dokumen metodologi. Event audit tidak
        dihapus karena kewajiban akuntabilitas, tetapi data pribadi di dalamnya diminimalkan.
      </p>

      <div className="actions">
        <Link to="/metodologi" className="btn btn--ghost">
          Cara angka ini dihitung
        </Link>
        <Link to="/" className="btn btn--ghost">
          Ke papan
        </Link>
      </div>
    </>
  );
}

export const Route = createFileRoute('/privasi')({
  loader: async ({ context }) => {
    const inventory = readLocalInventory();
    if (inventory.reportIds.length === 0) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(myReportsQuery()));
  },
  component: PrivacyPage,
});