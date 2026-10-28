import { useState } from 'react';

interface ScanFallbackProps {
  error: string | null;
  onSubmit: (value: string) => void;
}

const MAX_INPUT = 512;

export function ScanFallback({ error, onSubmit }: ScanFallbackProps) {
  const [value, setValue] = useState('');

  return (
    <form
      className="scanner-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="field">
        <label htmlFor="scan-input">Kode halte atau tautan QR</label>
        <input
          id="scan-input"
          name="scan"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={MAX_INPUT}
          value={value}
          aria-invalid={error !== null}
          aria-describedby={error === null ? 'scan-hint' : 'scan-hint scan-error'}
          onChange={(event) => {
            setValue(event.target.value.slice(0, MAX_INPUT));
          }}
          placeholder="BJM-014"
        />
        <p className="field-hint" id="scan-hint">
          Kode halte ada di bawah QR, contoh BJM-014. Kamu juga boleh menempel tautan lengkap dari QR.
        </p>
        {error === null ? null : (
          <p className="field-error" id="scan-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={value.trim().length === 0}>
          Buka halte
        </button>
      </div>
    </form>
  );
}