import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  roleLabel,
} from '../features/admin/console-ui';
import { fetchAudit } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/time';

function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');

  const audit = useQuery({
    queryKey: ['admin', 'audit', action, objectType],
    queryFn: () =>
      fetchAudit({
        ...(action.trim().length === 0 ? {} : { action: action.trim() }),
        ...(objectType.trim().length === 0 ? {} : { objectType: objectType.trim() }),
        limit: 60,
      }),
    staleTime: 15_000,
    retry: false,
  });

  return (
    <>
      <div className="page-head">
        <p className="label">Audit</p>
        <h1 className="page-title">Log tindakan platform</h1>
        <p className="page-lede">
          Setiap keputusan moderasi, pencabutan janji, dan perubahan tenggat meninggalkan satu baris
          di sini. Log ini tidak bisa diubah dari aplikasi.
        </p>
      </div>

      <div className="console-form">
        <div className="field">
          <label htmlFor="audit-action">Aksi</label>
          <input
            id="audit-action"
            type="text"
            maxLength={80}
            placeholder="mis. admin.moderation"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-object">Jenis objek</label>
          <input
            id="audit-object"
            type="text"
            maxLength={40}
            placeholder="mis. report"
            value={objectType}
            onChange={(event) => {
              setObjectType(event.target.value);
            }}
          />
        </div>
      </div>

      <ConsolePanel
        title="Baris audit"
        meta={audit.data === undefined ? 'memuat' : `${String(audit.data.length)} baris`}
      >
        {audit.isPending ? (
          <ConsoleHint>Memuat log audit.</ConsoleHint>
        ) : audit.isError ? (
          <ConsoleFailure
            title={describeError(audit.error).title}
            detail={describeError(audit.error).detail}
            onRetry={() => {
              void audit.refetch();
            }}
          />
        ) : audit.data.length === 0 ? (
          <ConsoleEmpty>Tidak ada baris audit untuk filter ini.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {audit.data.map((entry) => (
              <li key={entry.id} className="queue-row">
                <div className="queue-main">
                  <span className="queue-title">{entry.action}</span>
                  <span className="queue-text">
                    {entry.objectType}
                    {entry.objectId === null ? '' : ` · ${entry.objectId}`}
                  </span>
                </div>
                <p className="queue-meta">
                  <span>{formatDateTime(entry.createdAt)}</span>
                  <span>{roleLabel(entry.actorType)}</span>
                  {entry.actorId === null ? null : <span>{entry.actorId.slice(0, 8)}</span>}
                  {entry.requestId === null ? null : (
                    <span className="queue-code">{entry.requestId}</span>
                  )}
                </p>
                {Object.keys(entry.payload).length === 0 ? null : (
                  <details className="console-more">
                    <summary>Muatan</summary>
                    <pre className="console-pre">{JSON.stringify(entry.payload, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/audit')({
  component: AdminAuditPage,
});
