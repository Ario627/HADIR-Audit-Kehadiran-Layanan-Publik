export interface StopLeadProps {
  code: string;
  name: string;
  corridors: readonly string[];
  isDemo: boolean;
  eyebrow: string;
}

export function StopLead({ code, name, corridors, isDemo, eyebrow }: StopLeadProps) {
  return (
    <div className="page-head">
      <p className="label">
        {eyebrow} · {code}
      </p>
      <h1 className="page-title">{name}</h1>
      <p className="page-lede">
        {corridors.length === 0 ? 'Koridor belum terdaftar untuk halte ini.' : corridors.join(' · ')}
        {isDemo ? ' · data simulasi' : ''}
      </p>
    </div>
  );
}