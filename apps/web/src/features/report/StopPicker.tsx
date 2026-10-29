import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { stopsQuery } from '../../lib/queries';
import { StatePanel } from '../../components/StatePanel';

export interface StopPickerProps {
  disabled: boolean;
  onSelect: (stopCode: string) => void;
}

export function StopPicker({ disabled, onSelect }: StopPickerProps) {
  const [query, setQuery] = useState('');
  const results = useQuery({
    ...stopsQuery({ q: query, limit: 8 }),
    enabled: query.length >= 2,
  });

  return (
    <form
      className="stop-picker"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = data.get('q');
        setQuery(typeof value === 'string' ? value.trim() : '');
      }}
    >
      <div className="field">
        <label htmlFor="cari-halte">Halte mana</label>
        <input
          id="cari-halte"
          name="q"
          type="search"
          autoComplete="off"
          maxLength={100}
          placeholder="Nama atau kode halte"
          aria-describedby="cari-halte-hint"
        />
        <span className="field-hint" id="cari-halte-hint">
          Minimal 2 karakter. Pencarian diproses di server.
        </span>
      </div>
      <button type="submit" className="btn btn--ghost" disabled={disabled}>
        Cari
      </button>

      {query.length < 2 ? null : results.isPending ? (
        <StatePanel title="Mencari halte">Menunggu hasil pencarian.</StatePanel>
      ) : results.isError ? (
        <StatePanel tone="error" title="Pencarian gagal">
          Periksa koneksi lalu coba lagi.
        </StatePanel>
      ) : results.data.items.length === 0 ? (
        <StatePanel title="Tidak ada halte yang cocok">
          Coba kata kunci lain. Halte harus terdaftar agar laporan punya alamat yang sah.
        </StatePanel>
      ) : (
        <ul className="picker-results">
          {results.data.items.map((stop) => (
            <li key={stop.id}>
              <button
                type="button"
                className="picker-item"
                disabled={disabled}
                onClick={() => {
                  onSelect(stop.code);
                }}
              >
                <span className="board-code">{stop.code}</span>
                <span className="picker-name">{stop.name}</span>
                <span className="board-meta">
                  {stop.routes.length === 0
                    ? 'Koridor belum terdaftar'
                    : stop.routes.map((route) => route.code).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}