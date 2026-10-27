export type SyncPhase = 'idle' | 'saving' | 'error' | 'unreachable';

export type SyncSource = 'server' | 'device';

export interface SyncStatusProps {
  online: boolean;
  phase: SyncPhase;
  source: SyncSource;
  onRetry?: () => void;
}

export function syncMessage(online: boolean, phase: SyncPhase, source: SyncSource): string {
  if (phase === 'saving') {
    return 'Menyimpan ke server…';
  }
  if (phase === 'error') {
    return 'Gagal menyimpan. Catatan tetap ada di perangkat ini.';
  }
  if (phase === 'unreachable') {
    return 'Server tidak terjangkau. Waktu tetap dihitung dari perangkat ini.';
  }
  if (!online) {
    return 'Offline. Waktu tetap berjalan; kirim saat koneksi kembali.';
  }
  return source === 'server' ? 'Tersimpan di server' : 'Tersimpan di perangkat';
}

export function SyncStatus({ online, phase, source, onRetry }: SyncStatusProps) {
  return (
    <div className="ticket-status">
      <p className="ticket-status-text" role="status">
        {syncMessage(online, phase, source)}
      </p>
      {phase === 'error' && onRetry !== undefined ? (
        <button type="button" className="link-button" onClick={onRetry}>
          Coba simpan lagi
        </button>
      ) : null}
    </div>
  );
}