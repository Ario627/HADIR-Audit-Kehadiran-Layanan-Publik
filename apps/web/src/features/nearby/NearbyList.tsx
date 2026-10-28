import { Link } from '@tanstack/react-router';
import {
  formatDistanceMeters,
  offerDecision,
  type NearbyStop,
  type OfferDecision,
} from '../../lib/geo';

interface NearbyRowProps {
  item: NearbyStop;
  accuracyM: number;
  pendingCode: string | null;
  onPick: (item: NearbyStop) => void;
}

interface NearbyListProps {
  items: readonly NearbyStop[];
  accuracyM: number;
  pendingCode: string | null;
  onPick: (item: NearbyStop) => void;
}

function reasonText(decision: OfferDecision, item: NearbyStop, accuracyM: number): string | null {
  if (decision === 'offer') {
    return null;
  }
  if (decision === 'inaccurate') {
    return `Akurasi lokasi sekitar ${formatDistanceMeters(accuracyM)}, belum cukup untuk halte ini.`;
  }
  return `Jarak ${formatDistanceMeters(item.distanceM)} melewati radius halte ini.`;
}

function NearbyRow({ item, accuracyM, pendingCode, onPick }: NearbyRowProps) {
  const reason = reasonText(offerDecision({ distanceM: item.distanceM, accuracyM }), item, accuracyM);
  const busy = pendingCode === item.stop.code;
  return (
    <li className="nearby-item">
      <div className="nearby-head">
        <span className="nearby-code">{item.stop.code}</span>
        <span className="nearby-distance">{formatDistanceMeters(item.distanceM)}</span>
      </div>
      <p className="nearby-name">{item.stop.name}</p>
      <p className="nearby-meta">
        {item.stop.routes.length === 0
          ? 'Belum ada koridor terdaftar'
          : item.stop.routes.map((route) => route.code).join(' · ')}
      </p>
      {reason === null ? (
        <button
          type="button"
          className="btn btn--ghost nearby-action"
          onClick={() => {
            onPick(item);
          }}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Mencatat' : 'Catat tunggu di halte ini'}
        </button>
      ) : (
        <p className="nearby-reason">{reason}</p>
      )}
    </li>
  );
}

export function NearbyList({ items, accuracyM, pendingCode, onPick }: NearbyListProps) {
  if (items.length === 0) {
    return (
      <>
        <div className="page-head">
          <p className="label">Tidak ada halte dekat</p>
          <h2 className="page-title">Belum ada halte terdaftar di sekitar posisi ini</h2>
          <p className="page-lede">
            Papan bukti belum mencatat halte dalam radius tawaran. Pilih halte lewat daftar atau kode
            halte bila kamu tahu namanya.
          </p>
        </div>
        <div className="actions">
          <Link to="/" className="btn">
            Buka papan halte
          </Link>
        </div>
      </>
    );
  }

  return (
    <ul className="nearby-list">
      {items.map((item) => (
        <NearbyRow
          key={item.stop.id}
          item={item}
          accuracyM={accuracyM}
          pendingCode={pendingCode}
          onPick={onPick}
        />
      ))}
    </ul>
  );
}