import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ScanFallback } from '../features/scan/ScanFallback';
import { ScannerFrame } from '../features/scan/ScannerFrame';
import { readScannedText, scanErrorCopy, type ScanTarget } from '../lib/scan';
import { useBarcodeCamera } from '../lib/use-barcode-camera';

function ScanPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window === 'undefined' ? 'https://hadir.id' : window.location.origin;

  const follow = (target: ScanTarget): void => {
    void navigate({
      to: '/s/$stopCode',
      params: { stopCode: target.stopCode },
      search: target.search,
    });
  };

  const camera = useBarcodeCamera((raw) => {
    const outcome = readScannedText(raw, origin);
    if (outcome.kind === 'ok') {
      setError(null);
      follow(outcome.target);
      return;
    }
    setError(scanErrorCopy(outcome.error));
  });

  const submitManual = (value: string): void => {
    const outcome = readScannedText(value, origin);
    if (outcome.kind === 'ok') {
      setError(null);
      follow(outcome.target);
      return;
    }
    setError(scanErrorCopy(outcome.error));
  };

  return (
    <>
      <div className="page-head">
        <p className="label">Pindai</p>
        <h1 className="page-title">Mulai dari QR di halte</h1>
        <p className="page-lede">
          QR di tiang halte membawa kode halte dan tanda tangan keasliannya. Setelah terbaca, kamu
          langsung masuk ke halaman halte untuk mencatat lama tunggu.
        </p>
      </div>

      <ScannerFrame videoRef={camera.videoRef} status={camera.status} onStop={camera.stop} />

      {camera.message === null ? null : (
        <p className="note" role="status">
          {camera.message}
        </p>
      )}

      <div className="actions">
        {camera.supported && camera.status !== 'scanning' && camera.status !== 'starting' ? (
          <button type="button" className="btn" onClick={camera.start}>
            Nyalakan kamera
          </button>
        ) : null}
        <Link to="/" className="btn btn--ghost">
          Cari halte di papan
        </Link>
      </div>

      <ScanFallback error={error} onSubmit={submitManual} />

      <p className="note">
        Kamu juga bisa memindai QR dengan aplikasi kamera bawaan ponsel; tautannya membuka halaman halte
        yang sama.
      </p>
    </>
  );
}

export const Route = createFileRoute('/scan')({
  component: ScanPage,
});