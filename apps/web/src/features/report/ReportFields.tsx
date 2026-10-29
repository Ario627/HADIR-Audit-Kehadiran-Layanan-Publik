import { PhotoInput } from './PhotoInput';
import { CHECK_MAX, CHECK_MIN } from '../../lib/lapor-flow';

export interface ReportFieldsProps {
  text: string;
  acknowledged: boolean;
  disabled: boolean;
  textInvalid: boolean;
  acknowledgedInvalid: boolean;
  onChangeText: (value: string) => void;
  onChangeAcknowledged: (value: boolean) => void;
  onUploaded: (uploadId: string | null) => void;
}

export function ReportFields({
  text,
  acknowledged,
  disabled,
  textInvalid,
  acknowledgedInvalid,
  onChangeText,
  onChangeAcknowledged,
  onUploaded,
}: ReportFieldsProps) {
  const length = text.length;
  const remaining = Math.max(0, CHECK_MIN - length);

  return (
    <>
      <div className="field">
        <label htmlFor="teks-laporan">Ceritakan kejadiannya</label>
        <textarea
          id="teks-laporan"
          name="teks"
          rows={6}
          maxLength={CHECK_MAX}
          value={text}
          disabled={disabled}
          aria-invalid={textInvalid}
          aria-describedby="teks-hint teks-counter"
          onChange={(event) => {
            onChangeText(event.target.value);
          }}
          placeholder="Contoh: bus K3A tidak muncul 07.10–07.40, papan rute tidak diperbarui."
        />
        <span className="field-hint" id="teks-hint">
          Tulis tanpa nama, email, atau nomor telepon. Laporan tampil publik setelah moderasi.
        </span>
        <span className="field-hint" id="teks-counter">
          {remaining === 0
            ? `${length} karakter, cukup untuk dikirim`
            : `${length} dari ${CHECK_MIN} karakter, kurang ${remaining}`}
        </span>
      </div>

      <PhotoInput
        disabled={disabled}
        onUploaded={(photo) => {
          onUploaded(photo === null ? null : photo.uploadId);
        }}
      />

      <div className="field">
        <label className="ackrow" htmlFor="publikasi-ack">
          <input
            id="publikasi-ack"
            type="checkbox"
            name="publikasi"
            checked={acknowledged}
            disabled={disabled}
            aria-invalid={acknowledgedInvalid}
            onChange={(event) => {
              onChangeAcknowledged(event.target.checked);
            }}
          />
          <span>
            Saya mengerti laporan ini bisa dibaca publik setelah moderasi, dan saya tidak menuliskan
            data pribadi siapa pun.
          </span>
        </label>
      </div>
    </>
  );
}