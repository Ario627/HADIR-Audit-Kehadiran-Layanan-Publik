import { useEffect, useRef, useState } from 'react';
import { describeError } from '../../lib/errors';
import { uuidv7 } from '../../lib/id';
import { formatBytes, photoIssue } from '../../lib/photo';
import { uploadPhoto, type UploadedPhoto } from '../../lib/upload-api';

export interface PhotoInputProps {
  disabled: boolean;
  onUploaded: (photo: UploadedPhoto | null) => void;
}

type Phase = 'idle' | 'working' | 'ready' | 'error';

const ISSUE_TEXT = new Map([
  ['unsupported_type', 'Hanya foto JPEG, PNG, atau WebP.'],
  ['empty', 'Berkas ini kosong.'],
  ['too_large', 'Foto di atas 5 MB. Pilih foto lain.'],
]);

export function PhotoInput({ disabled, onUploaded }: PhotoInputProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview !== null) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  async function handleFile(file: File): Promise<void> {
    const issue = photoIssue(file);
    if (issue !== null) {
      setPhase('error');
      setMessage(ISSUE_TEXT.get(issue) ?? 'Foto tidak bisa dipakai.');
      return;
    }
    setPhase('working');
    setMessage(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview((previous) => {
      if (previous !== null) {
        URL.revokeObjectURL(previous);
      }
      return objectUrl;
    });
    try {
      const uploaded = await uploadPhoto(file, 'report_photo', uuidv7());
      setPhoto(uploaded);
      setPhase('ready');
      setMessage(`${formatBytes(uploaded.bytes)} · ${uploaded.width}×${uploaded.height}`);
      onUploaded(uploaded);
    } catch (error) {
      setPhase('error');
      setPhoto(null);
      onUploaded(null);
      setMessage(
        error instanceof Error && ISSUE_TEXT.has(error.message)
          ? (ISSUE_TEXT.get(error.message) ?? null)
          : describeError(error).detail,
      );
    }
  }

  function clear(): void {
    setPhoto(null);
    setPhase('idle');
    setMessage(null);
    setPreview((previous) => {
      if (previous !== null) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
    onUploaded(null);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  }

  return (
    <div className="photo">
      <div className="field">
        <label htmlFor="foto-bukti">Foto bukti (opsional)</label>
        <input
          ref={inputRef}
          id="foto-bukti"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={disabled || phase === 'working'}
          aria-describedby="foto-hint foto-status"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void handleFile(file);
            }
          }}
        />
        <span className="field-hint" id="foto-hint">
          Foto dikompres di perangkat ini sebelum dikirim, sehingga data lokasi di dalam foto ikut
          dihapus.
        </span>
        <span className="field-hint" id="foto-status" role="status">
          {phase === 'working' ? 'Mengompres dan mengunggah…' : (message ?? 'Belum ada foto.')}
        </span>
      </div>

      {preview === null ? null : (
        <figure className="photo-preview">
          <img src={preview} alt="Pratinjau foto bukti yang dipilih" width={320} height={240} />
          <figcaption className="field-hint">
            {phase === 'ready' && photo !== null
              ? `Terunggah · ${photo.uploadId.slice(0, 8)}`
              : 'Pratinjau lokal'}
          </figcaption>
        </figure>
      )}

      {phase === 'error' ? (
        <p className="field-error" role="alert">
          {message}
        </p>
      ) : null}

      {phase === 'idle' ? null : (
        <button type="button" className="link-button" onClick={clear} disabled={disabled}>
          Hapus foto
        </button>
      )}
    </div>
  );
}