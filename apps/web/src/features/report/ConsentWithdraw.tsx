import type { ConsentWithdrawalResult } from '@hadir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';

export function ConsentWithdraw({ publicId }: { publicId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const withdraw = useMutation({
    mutationFn: async (): Promise<ConsentWithdrawalResult> => {
      const envelope = await apiRequest<ConsentWithdrawalResult>(
        `/v1/reports/mine/${encodeURIComponent(publicId)}/consent`,
        { method: 'DELETE' },
      );
      return envelope.data;
    },
    onSuccess: async (result) => {
      setProblem(null);
      setOpen(false);
      setDone(
        result.alreadyWithdrawn
          ? 'Persetujuan sudah ditarik sebelumnya. Tidak ada perubahan baru.'
          : 'Persetujuan ditarik. Lampiran dan foto laporan ini tidak ditampilkan lagi.',
      );
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['report', publicId] });
      await queryClient.invalidateQueries({ queryKey: ['report', publicId, 'media'] });
    },
    onError: (error: unknown) => {
      setDone(null);
      setProblem(
        isApiError(error)
          ? describeError(error).detail
          : 'Penarikan persetujuan gagal. Coba lagi sebentar.',
      );
    },
  });

  if (done !== null) {
    return (
      <div className="consent">
        <p className="consent-done" role="status">
          {done}
        </p>
      </div>
    );
  }

  return (
    <div className="consent">
      {open ? (
        <>
          <p className="consent-ask">
            Tarik persetujuan untuk laporan {publicId}? Foto dan lampiran dihapus dari tampilan
            publik. Teks laporan dan riwayat penanganan tetap ada karena bagian dari catatan audit.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--danger"
              disabled={withdraw.isPending}
              onClick={() => {
                withdraw.mutate();
              }}
            >
              {withdraw.isPending ? 'Menarik…' : 'Ya, tarik persetujuan'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Batal
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="linkbtn"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
          }}
        >
          Tarik persetujuan foto
        </button>
      )}
      {problem === null ? null : (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
