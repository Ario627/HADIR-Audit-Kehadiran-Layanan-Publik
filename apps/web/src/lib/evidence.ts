import type { EvidenceLevel } from '@hadir/contracts';

export interface EvidenceDescriptor {
  level: EvidenceLevel;
  label: string;
  detail: string;
}

const DESCRIPTORS = new Map<EvidenceLevel, EvidenceDescriptor>([
  [
    'none',
    {
      level: 'none',
      label: 'Belum cukup data',
      detail: 'Jumlah episode, hari, atau perangkat belum memenuhi ambang minimum.',
    },
  ],
  [
    'indication',
    {
      level: 'indication',
      label: 'Indikasi',
      detail: 'Ada pola yang terlihat, tetapi syarat bukti kuat belum terpenuhi.',
    },
  ],
  [
    'strong',
    {
      level: 'strong',
      label: 'Bukti kuat',
      detail: 'Jumlah episode, keragaman perangkat, dan klaster memenuhi ambang.',
    },
  ],
  [
    'field_verified',
    {
      level: 'field_verified',
      label: 'Terverifikasi lapangan',
      detail: 'Diperiksa pengamat terlatih di lokasi.',
    },
  ],
]);

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  'none',
  'indication',
  'strong',
  'field_verified',
];

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === 'string' && DESCRIPTORS.has(value as EvidenceLevel);
}

export function evidenceOf(level: EvidenceLevel): EvidenceDescriptor {
  const descriptor = DESCRIPTORS.get(level);
  if (descriptor === undefined) {
    throw new Error(`Level bukti tidak dikenal: ${level}`);
  }
  return descriptor;
}