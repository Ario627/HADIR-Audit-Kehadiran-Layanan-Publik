import type {
  PartnerAction,
  PartnerActionInput,
  PartnerProfile,
  ReportCategory,
  ReportStatus,
} from '@hadir/contracts';
import type { FieldIssue } from './form-errors';

export type PartnerTone = 'primary' | 'secondary' | 'tertiary' | 'danger';

export interface ActionSpec {
  action: PartnerAction;
  label: string;
  confirm: string;
  tone: PartnerTone;
  noteLabel: string | null;
  noteMin: number;
  reasonRequired: boolean;
  scheduleRequired: boolean;
}

export type ActionIssue =
  | 'note_required'
  | 'note_too_short'
  | 'reason_required'
  | 'schedule_required'
  | 'schedule_in_past';

export interface ActionValues {
  note: string;
  reason: string;
  scheduledFor: string;
}

export interface InboxFilter {
  status: ReportStatus | 'all';
  category: ReportCategory | 'all';
}

export type PartnerTarget = '/partner' | '/partner/laporan';

const NOTE_MIN_EXPLAINED = 10;
const NOTE_MAX = 500;
const REASON_MAX = 200;
const SCHEDULE_TOLERANCE_MS = 60_000;

export const INBOX_STATUSES: readonly ReportStatus[] = [
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
  'closed',
];

export const OPEN_STATUSES = new Set<ReportStatus>([
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
]);

export const PARTNER_ACTIONS: readonly PartnerAction[] = [
  'acknowledge',
  'request_info',
  'schedule',
  'respond',
  'claim_resolved',
  'reject_with_reason',
];

const SPECS: Record<PartnerAction, ActionSpec> = {
  acknowledge: {
    action: 'acknowledge',
    label: 'Terima laporan',
    confirm: 'Tandai laporan ini sudah diterima instansimu?',
    tone: 'primary',
    noteLabel: 'Catatan tindak lanjut',
    noteMin: 0,
    reasonRequired: false,
    scheduleRequired: false,
  },
  request_info: {
    action: 'request_info',
    label: 'Minta keterangan',
    confirm: 'Minta keterangan tambahan kepada pelapor?',
    tone: 'secondary',
    noteLabel: 'Keterangan yang diminta',
    noteMin: 0,
    reasonRequired: false,
    scheduleRequired: false,
  },
  schedule: {
    action: 'schedule',
    label: 'Jadwalkan',
    confirm: 'Jadwalkan tindak lanjut untuk laporan ini?',
    tone: 'secondary',
    noteLabel: 'Rencana tindak lanjut',
    noteMin: 0,
    reasonRequired: false,
    scheduleRequired: true,
  },
  respond: {
    action: 'respond',
    label: 'Tanggapi',
    confirm: 'Kirim tanggapan ini ke halaman publik laporan?',
    tone: 'primary',
    noteLabel: 'Tanggapan untuk publik',
    noteMin: 0,
    reasonRequired: false,
    scheduleRequired: false,
  },
  claim_resolved: {
    action: 'claim_resolved',
    label: 'Klaim selesai',
    confirm: 'Klaim laporan ini selesai? Warga masih bisa membantahnya.',
    tone: 'primary',
    noteLabel: 'Bukti penyelesaian',
    noteMin: NOTE_MIN_EXPLAINED,
    reasonRequired: false,
    scheduleRequired: false,
  },
  reject_with_reason: {
    action: 'reject_with_reason',
    label: 'Tolak',
    confirm: 'Tolak laporan ini? Alasan akan tercatat di riwayat.',
    tone: 'danger',
    noteLabel: null,
    noteMin: 0,
    reasonRequired: true,
    scheduleRequired: false,
  },
};

const ISSUE_TEXT: Record<ActionIssue, string> = {
  note_required: 'Keterangan wajib diisi untuk aksi ini.',
  note_too_short: `Keterangan minimal ${NOTE_MIN_EXPLAINED} karakter agar bisa diperiksa.`,
  reason_required: 'Alasan penolakan wajib diisi.',
  schedule_required: 'Waktu tindak lanjut wajib diisi.',
  schedule_in_past: 'Pilih waktu setelah sekarang.',
};

const CATEGORY_VALUES = new Set<string>([
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
]);

const STATUS_VALUES = new Set<string>(INBOX_STATUSES);

const PARTNER_DETAIL_PATTERN = /^\/partner\/laporan\/[A-Za-z0-9]{6,40}$/;

export function actionSpec(action: PartnerAction): ActionSpec {
  return SPECS[action];
}

export function actionIssueText(issue: ActionIssue): string {
  return ISSUE_TEXT[issue];
}

const ISSUE_TARGETS: Record<ActionIssue, { field: string; label: string }> = {
  note_required: { field: 'action-note', label: 'Keterangan' },
  note_too_short: { field: 'action-note', label: 'Keterangan' },
  reason_required: { field: 'action-reason', label: 'Alasan penolakan' },
  schedule_required: { field: 'action-schedule', label: 'Waktu tindak lanjut' },
  schedule_in_past: { field: 'action-schedule', label: 'Waktu tindak lanjut' },
};

export function actionIssuesFor(issues: readonly ActionIssue[]): FieldIssue[] {
  const seen = new Set<string>();
  const output: FieldIssue[] = [];
  for (const issue of issues) {
    const target = ISSUE_TARGETS[issue];
    if (seen.has(target.field)) {
      continue;
    }
    seen.add(target.field);
    output.push({ field: target.field, label: target.label, message: actionIssueText(issue) });
  }
  return output;
}

export function isOpenStatus(status: ReportStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function isInboxStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && STATUS_VALUES.has(value);
}

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && CATEGORY_VALUES.has(value);
}

export function readInboxFilter(raw: Record<string, unknown>): InboxFilter {
  return {
    status: isInboxStatus(raw.status) ? raw.status : 'all',
    category: isReportCategory(raw.kategori) ? raw.kategori : 'all',
  };
}

export function toInboxSearch(filter: InboxFilter): { status?: string; kategori?: string } {
  const output: { status?: string; kategori?: string } = {};
  if (filter.status !== 'all') {
    output.status = filter.status;
  }
  if (filter.category !== 'all') {
    output.kategori = filter.category;
  }
  return output;
}

export function partnerTargetFor(raw: unknown): PartnerTarget | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null;
  }
  if (trimmed === '/partner') {
    return '/partner';
  }
  if (trimmed === '/partner/laporan' || PARTNER_DETAIL_PATTERN.test(trimmed)) {
    return '/partner/laporan';
  }
  return null;
}

export function minScheduleValue(now: number): string {
  const date = new Date(now - new Date(now).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function issuesForAction(
  action: PartnerAction,
  values: ActionValues,
  now: number,
): ActionIssue[] {
  const spec = actionSpec(action);
  const issues: ActionIssue[] = [];
  const note = values.note.trim();

  if (spec.reasonRequired && values.reason.trim().length === 0) {
    issues.push('reason_required');
  }
  if (spec.noteMin > 0) {
    if (note.length === 0) {
      issues.push('note_required');
    } else if (note.length < spec.noteMin) {
      issues.push('note_too_short');
    }
  }
  if (spec.scheduleRequired) {
    if (values.scheduledFor.trim().length === 0) {
      issues.push('schedule_required');
    } else {
      const at = Date.parse(values.scheduledFor);
      if (Number.isNaN(at) || at < now - SCHEDULE_TOLERANCE_MS) {
        issues.push('schedule_in_past');
      }
    }
  }
  return issues;
}

export function buildActionInput(
  action: PartnerAction,
  values: ActionValues,
): PartnerActionInput {
  const spec = actionSpec(action);
  const note = values.note.trim().slice(0, NOTE_MAX);
  const reason = values.reason.trim().slice(0, REASON_MAX);
  const input: PartnerActionInput = { action };
  if (spec.noteLabel !== null && note.length > 0) {
    input.note = note;
  }
  if (spec.reasonRequired && reason.length > 0) {
    input.reason = reason;
  }
  if (spec.scheduleRequired) {
    input.scheduledFor = new Date(values.scheduledFor).toISOString();
  }
  return input;
}

export function followUpText(followUpAt: string | null, now: number): string | null {
  if (followUpAt === null) {
    return null;
  }
  const at = Date.parse(followUpAt);
  if (Number.isNaN(at)) {
    return null;
  }
  const days = Math.round((at - now) / 86_400_000);
  if (days < -1) {
    return `Lewat ${Math.abs(days)} hari dari jadwal`;
  }
  if (days === -1) {
    return 'Lewat satu hari dari jadwal';
  }
  if (days === 0) {
    return followUpAt <= new Date(now).toISOString() ? 'Jatuh tempo hari ini' : 'Jadwal hari ini';
  }
  if (days === 1) {
    return 'Jadwal besok';
  }
  return `Jadwal ${days} hari lagi`;
}

export function ratioText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'belum ada data';
  }
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 100)}%`;
}

export function hoursText(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) {
    return 'belum ada data';
  }
  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} menit`;
  }
  if (hours < 48) {
    return `${Math.round(hours * 10) / 10} jam`;
  }
  return `${Math.round(hours / 24)} hari`;
}

export function bucketCountText(bucket: { count: number | null; suppressed: boolean }): string {
  if (bucket.suppressed || bucket.count === null) {
    return 'disembunyikan';
  }
  return String(bucket.count);
}

export interface PartnerAbilities {
  act: boolean;
  exportData: boolean;
  registerPasskey: boolean;
  removePasskey: boolean;
  revokeSessions: boolean;
}

const ABILITIES: Record<PartnerProfile['role'], PartnerAbilities> = {
  viewer: {
    act: false,
    exportData: false,
    registerPasskey: true,
    removePasskey: false,
    revokeSessions: false,
  },
  responder: {
    act: true,
    exportData: true,
    registerPasskey: true,
    removePasskey: false,
    revokeSessions: false,
  },
  admin: {
    act: true,
    exportData: true,
    registerPasskey: true,
    removePasskey: true,
    revokeSessions: true,
  },
};

export function abilitiesFor(role: PartnerProfile['role']): PartnerAbilities {
  return ABILITIES[role];
}

const ROLE_LABELS: Record<PartnerProfile['role'], string> = {
  viewer: 'Pembaca',
  responder: 'Penanggap',
  admin: 'Admin instansi',
};

export function roleLabel(role: PartnerProfile['role']): string {
  return ROLE_LABELS[role];
}

export function sessionAgeText(createdAt: string, now: number): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) {
    return 'Umur sesi tidak diketahui';
  }
  const minutes = Math.floor((now - at) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'Umur sesi tidak diketahui';
  }
  if (minutes < 1) {
    return 'Sesi baru dibuat';
  }
  if (minutes < 60) {
    return `Sesi dibuat ${minutes} menit lalu`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Sesi dibuat ${hours} jam lalu`;
  }
  return `Sesi dibuat ${Math.floor(hours / 24)} hari lalu`;
}

export function passkeyDeviceLabel(deviceType: string | null): string {
  if (deviceType === 'multiDevice') {
    return 'Passkey tersinkron';
  }
  if (deviceType === 'singleDevice') {
    return 'Terikat perangkat ini';
  }
  return 'Jenis perangkat tidak dilaporkan';
}

export function passkeyUsedText(lastUsedAt: string | null, now: number): string {
  if (lastUsedAt === null) {
    return 'Belum pernah dipakai';
  }
  const at = Date.parse(lastUsedAt);
  if (Number.isNaN(at)) {
    return 'Waktu pakai tidak diketahui';
  }
  const days = Math.floor((now - at) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) {
    return 'Waktu pakai tidak diketahui';
  }
  if (days === 0) {
    return 'Dipakai hari ini';
  }
  if (days === 1) {
    return 'Dipakai kemarin';
  }
  return `Dipakai ${days} hari lalu`;
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export interface PasswordIssues {
  current: string | null;
  next: string | null;
  confirm: string | null;
}

export interface PasswordInput {
  current: string;
  next: string;
  confirm: string;
}

export function readPasswordIssues(input: PasswordInput): PasswordIssues {
  const nextIssue =
    input.next.length < PASSWORD_MIN
      ? `Kata sandi baru minimal ${PASSWORD_MIN} karakter.`
      : input.next.length > PASSWORD_MAX
        ? `Kata sandi baru maksimal ${PASSWORD_MAX} karakter.`
        : input.next === input.current && input.next.length > 0
          ? 'Kata sandi baru harus berbeda dari yang sekarang.'
          : null;
  return {
    current: input.current.length === 0 ? 'Kata sandi sekarang wajib diisi.' : null,
    next: nextIssue,
    confirm: input.confirm !== input.next ? 'Ulangi kata sandi baru dengan tepat.' : null,
  };
}

export function hasPasswordIssue(issues: PasswordIssues): boolean {
  return issues.current !== null || issues.next !== null || issues.confirm !== null;
}

const PASSWORD_FIELDS: readonly { key: keyof PasswordIssues; id: string; label: string }[] = [
  { key: 'current', id: 'password-current', label: 'Kata sandi sekarang' },
  { key: 'next', id: 'password-next', label: 'Kata sandi baru' },
  { key: 'confirm', id: 'password-confirm', label: 'Ulangi kata sandi baru' },
];

export function collectPasswordIssues(issues: PasswordIssues): FieldIssue[] {
  const output: FieldIssue[] = [];
  for (const entry of PASSWORD_FIELDS) {
    const message = issues[entry.key];
    if (message !== null) {
      output.push({ field: entry.id, label: entry.label, message });
    }
  }
  return output;
}