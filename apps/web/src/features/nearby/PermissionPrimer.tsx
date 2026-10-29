import { Link } from '@tanstack/react-router';
import { MAX_ACCURACY_M, MAX_NEARBY_M } from '../../lib/geo';

interface PermissionPrimerProps {
  onRequest: () => void;
  busy: boolean;
}

export function PermissionPrimer({ onRequest, busy }: PermissionPrimerProps) {
  return (
    <section className="primer" aria-labelledby="primer-title">
      <h2 className="primer-title" id="primer-title">
        Boleh baca posisi sekali ini?
      </h2>
      <p className="primer-text">
        Posisi dipakai untuk menghitung jarak ke halte terdekat di perangkat ini. Yang dikirim ke server
        hanya kategori jarak, kategori akurasi, dan permintaan wilayah kasar sekitar satu kilometer.
        Titik presisimu tidak pernah dikirim.
      </p>
      <ul className="primer-list">
        <li>Pembacaan hanya berjalan setelah kamu menekan tombol, tidak saat halaman dibuka.</li>
        <li>
          Tawaran mencatat muncul bila jarak ke halte paling jauh {MAX_NEARBY_M} m dan akurasi paling
          buruk {MAX_ACCURACY_M} m.
        </li>
        <li>Kamu bisa menolak lokasi sepenuhnya dan tetap mencatat lewat kode halte.</li>
      </ul>
      <div className="actions">
        <button type="button" className="btn" onClick={onRequest} disabled={busy} aria-busy={busy}>
          {busy ? 'Membaca lokasi' : 'Baca lokasi saya'}
        </button>
        <Link to="/" className="btn btn--ghost">
          Pilih halte manual
        </Link>
      </div>
      <p className="note">
        Metode GPS adalah bukti terlemah yang tercatat. Tanpa pindai QR, kehadiranmu ditandai belum
        terverifikasi di papan bukti.
      </p>
    </section>
  );
}