import type {
  ReportCategory,
  SourceTier,
  TriageAction,
  TriageResult,
  TriageVerdict,
} from '@hadir/contracts';

export type TriageActionKind = TriageAction['kind'];

export type ActionIntent = 'send' | 'measure' | 'corridor' | 'join' | 'unsupported';

export interface PlannedAction {
  kind: TriageActionKind;
  label: string;
  intent: ActionIntent;
}

const ACTION_INTENT = new Map<TriageActionKind, ActionIntent>([
  ['send_anyway', 'send'],
  ['measure', 'measure'],
  ['open_radar', 'corridor'],
  ['join', 'join'],
  ['monitor', 'unsupported'],
  ['send_elsewhere', 'unsupported'],
]);

const TIER_LABELS = new Map<SourceTier, string>([
  ['T1', 'Dokumen resmi'],
  ['T2', 'Rencana'],
  ['T3', 'Pengukuran'],
  ['T4', 'Laporan warga'],
]);

const VERDICT_LABELS = new Map<TriageVerdict, string>([
  ['join', 'Laporan serupa sudah ada'],
  ['already_planned', 'Sudah ada rencana resmi'],
  ['wrong_authority', 'Bukan kewenangan instansi ini'],
  ['service_not_running', 'Layanan tidak berjalan'],
  ['data_supports', 'Pengukuran warga mendukung'],
  ['data_insufficient', 'Data belum cukup'],
  ['new_report', 'Laporan baru'],
]);

const CATEGORY_TO_SERVICE = new Set<ReportCategory>([
  'service_wait',
  'service_no_show',
  'service_full',
]);

export function tierLabel(tier: SourceTier): string {
  return TIER_LABELS.get(tier) ?? 'Sumber';
}

export function verdictLabel(verdict: TriageVerdict): string {
  return VERDICT_LABELS.get(verdict) ?? 'Hasil pemeriksaan';
}

export function isServiceCategory(category: ReportCategory): boolean {
  return CATEGORY_TO_SERVICE.has(category);
}

export function intentOf(kind: TriageActionKind): ActionIntent {
  return ACTION_INTENT.get(kind) ?? 'unsupported';
}

export function joinTarget(result: TriageResult): string | null {
  for (const item of result.evidence) {
    if (item.targetPublicId !== null) {
      return item.targetPublicId;
    }
  }
  return null;
}

export function planActions(
  actions: readonly TriageAction[],
  options: { hasRoute: boolean; joinTarget: string | null },
): PlannedAction[] {
  const planned: PlannedAction[] = [];
  for (const action of actions) {
    const base = intentOf(action.kind);
    if (base === 'corridor' && !options.hasRoute) {
      continue;
    }
    if (base === 'join' && options.joinTarget === null) {
      planned.push({ kind: action.kind, label: action.label, intent: 'unsupported' });
      continue;
    }
    planned.push({ kind: action.kind, label: action.label, intent: base });
  }
  return planned;
}

export function unsupportedLabels(planned: readonly PlannedAction[]): string[] {
  return planned.filter((action) => action.intent === 'unsupported').map((action) => action.label);
}

export function connectorNote(connectors: TriageResult['connectors']): string | null {
  const states = Object.values(connectors);
  if (states.some((state) => state === 'unavailable')) {
    return 'Sebagian pemeriksaan tidak bisa diakses saat ini, jadi hasilnya bisa belum lengkap.';
  }
  if (states.length > 0 && states.every((state) => state === 'not_configured')) {
    return 'Pemeriksaan otomatis belum tersambung ke sumber data mana pun.';
  }
  return null;
}

export function evidenceCount(result: TriageResult): number {
  return result.evidence.length;
}