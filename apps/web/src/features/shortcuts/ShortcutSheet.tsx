import { useEffect, useRef } from 'react';
import { comboLabel, HELP_KEY, LEADER_KEY, LEADER_TARGETS } from '../../lib/shortcuts';

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <section className="shortcuts" aria-labelledby="pintasan-judul">
      <div className="shortcuts-head">
        <h2 className="section-title" id="pintasan-judul">
          Pintasan keyboard
        </h2>
        <button ref={closeRef} type="button" className="btn btn--ghost" onClick={onClose}>
          Tutup
        </button>
      </div>
      <p className="note">
        Pintasan tidak aktif saat kursor berada di kolom isian, supaya mengetik huruf biasa tidak
        berpindah halaman.
      </p>
      <dl className="shortcuts-list">
        <div>
          <dt>
            <kbd>{LEADER_KEY.toUpperCase()}</kbd>
          </dt>
          <dd>Awalan pintasan. Tekan lalu lepas, kemudian tekan huruf tujuan.</dd>
        </div>
        {Object.entries(LEADER_TARGETS).map(([key, target]) => (
          <div key={key}>
            <dt>
              <kbd>{comboLabel(key)}</kbd>
            </dt>
            <dd>{target.label}</dd>
          </div>
        ))}
        <div>
          <dt>
            <kbd>{HELP_KEY}</kbd>
          </dt>
          <dd>Buka panel pintasan ini.</dd>
        </div>
        <div>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>Tutup panel pintasan.</dd>
        </div>
      </dl>
    </section>
  );
}