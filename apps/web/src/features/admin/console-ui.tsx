import type { ReactNode } from 'react';

const MODERATION_LABEL: Readonly<Record<string, string>> = {
  pending: 'menunggu',
  approved: 'lolos',
  rejected: 'ditolak',
  quarantined: 'karantina',
};

const MODERATION_TONE: Readonly<Record<string, string>> = {
  pending: 'pending',
  approved: 'verified',
  rejected: 'alert',
  quarantined: 'strong',
};

const NOTICE_KIND_LABEL: Readonly<Record<string, string>> = {
  detour: 'Pengalihan',
  repair: 'Perbaikan',
  suspension: 'Penghentian',
  schedule: 'Jadwal',
  other: 'Lainnya',
};

const IMPACT_LABEL: Readonly<Record<string, string>> = {
  none: 'tanpa gangguan',
  minor: 'gangguan kecil',
  major: 'gangguan besar',
  service_stopped: 'layanan berhenti',
};

const IMPACT_TONE: Readonly<Record<string, string>> = {
  none: 'none',
  minor: 'indication',
  major: 'strong',
  service_stopped: 'alert',
};

const SLA_PHASE_LABEL: Readonly<Record<string, string>> = {
  acknowledge: 'pengakuan',
  respond: 'tanggapan',
  resolve: 'penyelesaian',
};

const APPEAL_STATUS_LABEL: Readonly<Record<string, string>> = {
  submitted: 'masuk',
  inadmissible: 'tidak dapat diterima',
  admitted: 'diterima',
  upheld: 'dikuatkan',
  overturned: 'dibatalkan',
};

const COMMITMENT_STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: 'draf',
  verified: 'terverifikasi',
  superseded: 'digantikan',
  revoked: 'dicabut',
};

const DAY_SCOPE_LABEL: Readonly<Record<string, string>> = {
  all: 'semua hari',
  weekday: 'hari kerja',
  weekend: 'akhir pekan',
  holiday: 'hari libur',
};

const PRIORITY_LABEL: Readonly<Record<string, string>> = {
  low: 'rendah',
  normal: 'normal',
  high: 'tinggi',
  critical: 'kritis',
};

const ROLE_LABEL: Readonly<Record<string, string>> = {
  viewer: 'pembaca',
  responder: 'penanggap',
  admin: 'admin instansi',
  moderator: 'moderator',
  superadmin: 'superadmin',
};

export function moderationLabel(value: string): string {
  return MODERATION_LABEL[value] ?? value;
}

export function moderationTone(value: string): string {
  return MODERATION_TONE[value] ?? 'none';
}

export function noticeKindLabel(value: string): string {
  return NOTICE_KIND_LABEL[value] ?? value;
}

export function impactLabel(value: string): string {
  return IMPACT_LABEL[value] ?? value;
}

export function impactTone(value: string): string {
  return IMPACT_TONE[value] ?? 'none';
}

export function slaPhaseLabel(value: string): string {
  return SLA_PHASE_LABEL[value] ?? value;
}

export function appealStatusLabel(value: string): string {
  return APPEAL_STATUS_LABEL[value] ?? value;
}

export function commitmentStatusLabel(value: string): string {
  return COMMITMENT_STATUS_LABEL[value] ?? value;
}

export function dayScopeLabel(value: string): string {
  return DAY_SCOPE_LABEL[value] ?? value;
}

export function priorityLabel(value: string): string {
  return PRIORITY_LABEL[value] ?? value;
}

export function roleLabel(value: string): string {
  return ROLE_LABEL[value] ?? value;
}

export function hoursText(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value >= 48 ? `${String(Math.round(value / 24))} hari` : `${String(Math.round(value))} jam`;
}

export function ConsolePanel({
  title,
  meta,
  actions,
  children,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="console-panel">
      <header className="console-panel-head">
        <h2 className="console-panel-title">{title}</h2>
        {meta === undefined ? null : <p className="console-panel-meta">{meta}</p>}
        {actions === undefined ? null : <div className="console-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function ConsoleHint({ children }: { children: ReactNode }) {
  return <p className="console-hint">{children}</p>;
}

export function ConsoleEmpty({ children }: { children: ReactNode }) {
  return <p className="console-empty">{children}</p>;
}

export function ConsoleFailure({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className="console-failure" role="alert">
      <p className="console-failure-title">{title}</p>
      <p className="console-failure-detail">{detail}</p>
      <button type="button" className="link-button" onClick={onRetry}>
        Coba lagi
      </button>
    </div>
  );
}
