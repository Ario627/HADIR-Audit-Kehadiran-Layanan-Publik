import { stopStatusLabel, stopStatusNote, type StopStatus } from '../../lib/stop-status';

export interface StopLeadProps {
  code: string;
  name: string;
  corridors: readonly string[];
  isDemo: boolean;
  eyebrow: string;
  status: StopStatus;
}

export function StopLead({ code, name, corridors, isDemo, eyebrow, status }: StopLeadProps) {
  const note = stopStatusNote(status);
  return (
    <div className="page-head">
      <p className="label">
        {eyebrow} · {code}
        {note === null ? null : ` · ${stopStatusLabel(status)}`}
      </p>
      <h1 className="page-title">{name}</h1>
      <p className="page-lede">
        {corridors.length === 0 ? 'Koridor belum terdaftar untuk halte ini.' : corridors.join(' · ')}
        {isDemo ? ' · data simulasi' : ''}
      </p>
      {note === null ? null : (
        <p className="stopnote" data-tone={note.tone} role="status">
          <strong>{note.title}.</strong> {note.body}
        </p>
      )}
    </div>
  );
}