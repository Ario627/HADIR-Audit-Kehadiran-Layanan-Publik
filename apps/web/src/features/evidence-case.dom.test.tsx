import type { CaseFile, EvidencePack } from '@hadir/contracts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseTracker } from './report/CaseTracker';
import { EvidenceDossier } from './stop/EvidenceDossier';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(node: React.ReactNode): void {
  act(() => {
    root.render(node);
  });
}

function pack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  const base: EvidencePack = {
    stopId: '0192f0d0-0000-7000-8000-000000000001',
    stopCode: 'BJM-014',
    stopName: 'Halte A. Yani',
    generatedAt: '2026-11-10T03:00:00.000Z',
    dayScope: 'weekday',
    holidayName: null,
    benchmark: {
      status: 'resolved',
      commitmentId: '0192f0d0-0000-7000-8000-000000000010',
      specificity: 'stop',
      headwayMin: 10,
      idealWaitMin: 5,
      thresholdMin: 15,
      sourceDocumentUrl: 'https://dishub.go.id/janji.pdf',
      sourceDocumentVersion: 'v2',
      validFrom: '2026-01-01',
      validUntil: null,
      message: 'Janji layanan berlaku sejak 2026.',
    },
    quality: {
      dimensions: [
        { dimension: 'strength', score: 0.4, band: 'low', reasons: [] },
        { dimension: 'precision', score: 0.6, band: 'moderate', reasons: [] },
        { dimension: 'coverage', score: 0.5, band: 'moderate', reasons: [] },
        { dimension: 'reliability', score: 0.8, band: 'high', reasons: [] },
        { dimension: 'corroboration', score: 0.2, band: 'very_low', reasons: [] },
      ],
      limiting: 'strength',
      band: 'moderate',
      score: 0.5,
      fieldVerifiedEligible: false,
      warnings: [],
    },
    representativeness: { score: 0.35, band: 'low', limitedTo: null, warnings: [] },
    context: { events: [], segments: [], dominantImpact: null, caveats: [] },
    provenance: null,
    snapshot: {
      id: '0192f0d0-0000-7000-8000-000000000020',
      subjectKind: 'stop_estimate',
      subjectRef: 'BJM-014',
      methodVersion: 'km-v1',
      datasetDigest: 'sha256:abcdef0123456789',
      outputDigest: 'sha256:fedcba9876543210',
      inputRows: 42,
      evidenceLevel: 'indication',
      direction: 'excess',
      warnings: [],
      computedAt: '2026-11-10T03:00:00.000Z',
    },
    disclaimer: 'Angka ini indikasi, bukan putusan.',
  };
  return { ...base, ...overrides };
}

describe('EvidenceDossier', () => {
  it('shows the resolved promise and the five quality meters', () => {
    render(<EvidenceDossier pack={pack()} />);

    expect(container.textContent).toContain('Dasar bukti');
    expect(container.textContent).toContain('Janji 10 menit · ambang 15 menit');
    expect(container.textContent).toContain('Dokumen versi v2 per halte');
    expect(container.textContent).toContain('Penentu terlemah: kekuatan bukti');

    const meters = container.querySelectorAll('progress.meter-bar');
    expect(meters).toHaveLength(5);
    expect(meters[0]?.getAttribute('value')).toBe('40');
    expect(meters[0]?.getAttribute('aria-label')).toBe('Kekuatan bukti');
  });

  it('never invents a benchmark when the promise is unavailable', () => {
    render(
      <EvidenceDossier
        pack={pack({
          benchmark: {
            status: 'unavailable',
            reason: 'no_commitment',
            message: 'Belum ada dokumen.',
            considered: 0,
          },
        })}
      />,
    );

    expect(container.textContent).toContain('Tanpa janji layanan');
    expect(container.textContent).toContain(
      'Belum ada janji layanan resmi untuk halte atau koridor ini.',
    );
    expect(container.querySelector('a[href]')).toBeNull();
  });

  it('keeps long methodology text inside a collapsed disclosure', () => {
    render(<EvidenceDossier pack={pack()} />);

    const details = container.querySelector('details.dossier-more');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(
      'Metode, sumber, dan keterbatasan',
    );
    expect(details?.textContent).toContain('Angka ini indikasi, bukan putusan.');
  });

  it('labels the day scope it resolved against', () => {
    render(<EvidenceDossier pack={pack({ dayScope: 'holiday', holidayName: 'Natal' })} />);

    expect(container.textContent).toContain('hari libur');
    expect(container.textContent).toContain('Tanggal ini hari libur: Natal.');
  });
});

function caseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  const base: CaseFile = {
    publicId: 'LPR-2026-007919',
    status: 'acknowledged',
    category: 'service_wait',
    createdAt: '2026-11-01T00:00:00.000Z',
    milestones: {
      entries: [
        {
          key: 'submitted',
          at: '2026-11-01T00:00:00.000Z',
          actorType: 'citizen',
          label: 'Laporan diterima',
          terminal: false,
        },
        {
          key: 'acknowledged',
          at: '2026-11-01T05:00:00.000Z',
          actorType: 'partner',
          label: 'Diakui instansi',
          terminal: false,
        },
      ],
      current: 'acknowledged',
      next: 'responded',
      progress: 0.4,
      terminal: null,
      pendingInfoRequest: false,
      gaps: [],
      caveats: [],
    },
    sla: {
      policyVersion: 'sla-v1',
      priority: 'normal',
      targets: { acknowledgeHours: 24, respondHours: 72, resolveHours: 168 },
      phases: [
        {
          phase: 'acknowledge',
          dueAt: '2026-11-02T00:00:00.000Z',
          metAt: '2026-11-01T05:00:00.000Z',
          state: 'met',
          lateByHours: null,
          remainingHours: null,
        },
        {
          phase: 'respond',
          dueAt: '2026-11-04T00:00:00.000Z',
          metAt: null,
          state: 'pending',
          lateByHours: null,
          remainingHours: 30,
        },
        {
          phase: 'resolve',
          dueAt: '2026-11-08T00:00:00.000Z',
          metAt: null,
          state: 'not_started',
          lateByHours: null,
          remainingHours: null,
        },
      ],
      breached: false,
      escalation: 0,
      summary: 'Tenggat normal.',
    },
    responses: [
      {
        id: '0192f0d0-0000-7000-8000-000000000030',
        kind: 'initial',
        body: 'Kami menurunkan petugas untuk mengecek headway.',
        evidenceUrls: [],
        institutionId: '0192f0d0-0000-7000-8000-000000000040',
        institutionName: 'Dishub Kota',
        authorDisplayName: null,
        correctsResponseId: null,
        publishedAt: '2026-11-01T06:00:00.000Z',
        attestation: {
          signed: true,
          status: 'verified',
          bodyDigest: 'a'.repeat(64),
          signingKeyId: 'key-1',
          keyFingerprint: 'ABCD1234',
          algorithm: 'ed25519',
          signedAt: '2026-11-01T06:00:00.000Z',
          message: 'Tanda tangan sah.',
        },
      },
    ],
    verifications: [],
    resolution: {
      outcome: 'undecided',
      reason: 'Belum ada bukti perbaikan.',
      supporting: 0,
      refuting: 0,
      inconclusive: 0,
      conflicts: [],
      cautions: [],
    },
    caveats: [],
  };
  return { ...base, ...overrides };
}

describe('CaseTracker', () => {
  it('renders the milestone rail, the SLA strip and the outcome', () => {
    render(<CaseTracker caseFile={caseFile()} />);

    expect(container.textContent).toContain('Jejak penanganan');
    expect(container.textContent).toContain('Tahap berikutnya: ditanggapi.');
    expect(container.textContent).toContain('Diakui instansi');
    expect(container.textContent).toContain('Akui 24 j · tanggap 72 j · selesai 168 j');
    expect(container.textContent).toContain('sisa 30 jam');
    expect(container.textContent).toContain('Klaim belum terbukti');

    const bar = container.querySelector('progress.case-bar');
    expect(bar?.getAttribute('value')).toBe('40');
    expect(bar?.getAttribute('max')).toBe('100');
  });

  it('shows the attestation badge of a signed response', () => {
    render(<CaseTracker caseFile={caseFile()} />);

    const badge = container.querySelector('.attest');
    expect(badge?.textContent).toContain('Tertanda tangan');
    expect(badge?.className).toContain('attest--verified');
    expect(badge?.textContent).toContain('ABCD1234');
  });

  it('says plainly when no official response exists yet', () => {
    render(<CaseTracker caseFile={caseFile({ responses: [] })} />);

    expect(container.textContent).toContain('Belum ada tanggapan resmi pada kasus ini.');
    expect(container.querySelector('.case-response')).toBeNull();
  });

  it('keeps caveats behind a disclosure', () => {
    render(
      <CaseTracker
        caseFile={caseFile({
          caveats: ['Sebagian bukti berasal dari laporan anonim.'],
        })}
      />,
    );

    const details = container.querySelector('details.case-more');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('Sebagian bukti berasal dari laporan anonim.');
  });
});
