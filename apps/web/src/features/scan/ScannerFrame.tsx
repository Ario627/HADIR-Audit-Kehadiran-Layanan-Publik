import type { RefObject } from 'react';
import type { CameraStatus } from '../../lib/use-barcode-camera';

interface ScannerFrameProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  onStop: () => void;
}

export function ScannerFrame({ videoRef, status, onStop }: ScannerFrameProps) {
  const active = status === 'scanning' || status === 'starting';
  return (
    <section className="scanner" aria-labelledby="scanner-title">
      <h2 className="scanner-title" id="scanner-title">
        {active ? 'Arahkan ke QR di halte' : 'Kamera siap dinyalakan'}
      </h2>
      <div className="scanner-stage">
        <video
          ref={videoRef}
          className="scanner-video"
          playsInline
          muted
          aria-label="Pratinjau kamera untuk memindai QR"
        />
        <div className="scanner-frame" aria-hidden="true" />
        {active ? null : (
          <p className="scanner-hint">
            Kamera hanya menyala setelah kamu menekan tombol. Gambar tidak dikirim ke mana pun.
          </p>
        )}
      </div>
      {active ? (
        <div className="actions">
          <button type="button" className="btn btn--ghost" onClick={onStop}>
            Hentikan kamera
          </button>
        </div>
      ) : null}
    </section>
  );
}