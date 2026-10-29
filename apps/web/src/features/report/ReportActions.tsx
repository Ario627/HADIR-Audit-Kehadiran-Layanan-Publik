import { useState } from 'react';
import type { ReportDetail } from '@hadir/contracts';
import { describeError } from '../../lib/errors';
import { acceptsCorroboration, needsCitizenClosure } from '../../lib/report';
import {
  useCorroborate,
  useVerifyClosure,
  type ClosureRequest,
} from './use-report-actions';

export interface ReportActionsProps {
  report: ReportDetail;
}

const CLOSURE_OPTIONS: ReadonlyArray<{ value: ClosureRequest['answer']; label: string }> = [
  { value: 'yes', label: 'Ya, sudah beres' },
  { value: 'partial', label: 'Sebagian saja' },
  { value: 'no', label: 'Belum, masih sama' },
];

export function ReportActions({ report }: ReportActionsProps) {
  const corroborate = useCorroborate();
  const closure = useVerifyClosure();
  const [answer, setAnswer] = useState<ClosureRequest['answer']>('yes');

  const corroborateError = corroborate.isError ? describeError(corroborate.error) : null;
  const closureError = closure.isError ? describeError(closure.error) : null;
  const closureAnswer = closure.data?.status;

  return (
    <section className="report-actions" aria-labelledby="report-actions-heading">
      <h2 className="label" id="report-actions-heading">
        Tindakan
      </h2>

      {acceptsCorroboration(report.status) ? (
        <div className="report-action">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={corroborate.isPending}
            onClick={() => {
              corroborate.mutate({ publicId: report.publicId, note: '' });
            }}
          >
            {corroborate.isPending ? 'Menyimpan…' : 'Saya juga mengalami ini'}
          </button>
          <p className="report-action-note">
            {corroborate.data === undefined
              ? 'Dukungan dicatat sekali per perangkat. Laporan sendiri tidak bisa didukung.'
              : corroborate.data.alreadyCounted
                ? `Dukunganmu sudah tercatat. Total ${corroborate.data.corroborationCount}.`
                : `Dukungan tercatat. Total ${corroborate.data.corroborationCount}.`}
          </p>
          {corroborateError === null ? null : (
            <p className="field-error" role="alert">
              {corroborateError.title}. {corroborateError.detail}
            </p>
          )}
        </div>
      ) : null}

      {needsCitizenClosure(report.status) ? (
        <form
          className="report-action"
          onSubmit={(event) => {
            event.preventDefault();
            closure.mutate({ publicId: report.publicId, answer, note: '' });
          }}
        >
          <fieldset className="closure">
            <legend className="label">Instansi mengklaim selesai. Apakah benar?</legend>
            {CLOSURE_OPTIONS.map((option) => (
              <label key={option.value} className="closure-option" data-selected={answer === option.value}>
                <input
                  type="radio"
                  name="closure"
                  value={option.value}
                  checked={answer === option.value}
                  onChange={() => {
                    setAnswer(option.value);
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn" disabled={closure.isPending}>
            {closure.isPending ? 'Mengirim…' : 'Kirim verifikasi'}
          </button>
          {closureError === null ? null : (
            <p className="field-error" role="alert">
              {closureError.title}. {closureError.detail}
            </p>
          )}
          {closureAnswer === undefined ? null : (
            <p className="report-action-note" role="status">
              Verifikasi tercatat. Status laporan sekarang: {closureAnswer}.
            </p>
          )}
        </form>
      ) : null}
    </section>
  );
}