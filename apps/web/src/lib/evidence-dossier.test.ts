import { describe, expect, it } from 'vitest';
import type { CaseFile, EvidencePack } from '@hadir/contracts';
import { caseFileSchema, evidencePackSchema } from './evidence-guards';
import {
  attestationLabel,
  attestationTone,
  bandLabel,
  benchmarkCaption,
  benchmarkHeadline,
  benchmarkReasonText,
  contextSummary,
  dayScopeLabel,
  dayScopeNote,
  dimensionLabel,
  impactLabel,
  milestoneLabel,
  milestoneProgress,
  nextMilestoneText,
  outcomeLabel,
  outcomeTone,
  percentText,
  provenanceLine,
  qualityActionText,
  qualityLimitingText,
  qualityVerdictText,
  resolutionCounts,
  responseKindLabel,
  scorePercent,
  shortDigest,
  slaHeadline,
  slaPhaseLabel,
  slaPhaseValue,
  slaStateLabel,
  verdictLabel,
} from './evidence-readout';

function pack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  const base: EvidencePack = {
    stopId: '0192f0d0-0000-7000-8000-000000000001',
    stopCode: 'BJM-014',
    stopName: 'Halte A. Yani',
    generatedAt: '2026-05-01T03:00:00.000Z',
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
        { dimension: 'strength', score: 0.4, band: 'low', reasons: ['episode sedikit'] },
        { dimension: 'precision', score: 0.6, band: 'moderate', reasons: ['sebaran lebar'] },
        { dimension: 'coverage', score: 0.5, band: 'moderate', reasons: ['jam sibuk saja'] },
        { dimension: 'reliability', score: 0.8, band: 'high', reasons: ['sumber tunggal'] },
        {
          dimension: 'corroboration',
          score: 0.2,
          band: 'very_low',
          reasons: ['tanpa pihak ketiga'],
        },
      ],
      limiting: 'strength',
      band: 'moderate',
      score: 0.5,
      fieldVerifiedEligible: false,
      warnings: ['belum ada verifikasi lapangan'],
    },
    representativeness: {
      score: 0.35,
      band: 'low',
      limitedTo: 'Hanya jam sibuk pagi',
      warnings: [{ code: 'small_sample', detail: 'Sepuluh episode pertama.' }],
    },
    context: {
      events: [],
      segments: [],
      dominantImpact: null,
      caveats: [],
    },
    provenance: null,
    snapshot: {
      id: '0192f0d0-0000-7000-8000-000000000020',
      subjectKind: 'stop_estimate',
      subjectRef: 'BJM-014',
      methodVersion: 'm3.2',
      datasetDigest: 'sha256:abcdef0123456789abcdef',
      outputDigest: 'sha256:fedcba9876543210fedcba',
      inputRows: 42,
      evidenceLevel: 'indication',
      direction: 'excess',
      warnings: [],
      computedAt: '2026-05-01T03:00:00.000Z',
    },
    disclaimer: 'Angka ini indikasi, bukan putusan.',
  };
  return { ...base, ...overrides };
}

function phaseAt(sla: NonNullable<CaseFile['sla']>, index: number) {
  const phase = sla.phases[index];
  if (phase === undefined) {
    throw new Error('fixture SLA tidak lengkap');
  }
  return phase;
}

function caseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  const base: CaseFile = {
    publicId: 'RPT123456',
    status: 'acknowledged',
    category: 'service_wait',
    createdAt: '2026-04-30T01:00:00.000Z',
    milestones: {
      entries: [
        {
          key: 'submitted',
          at: '2026-04-30T01:00:00.000Z',
          actorType: 'citizen',
          label: 'Laporan dikirim',
          terminal: false,
        },
        {
          key: 'acknowledged',
          at: '2026-04-30T05:00:00.000Z',
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
      policyVersion: 'sla-2026.1',
      priority: 'normal',
      targets: { acknowledgeHours: 24, respondHours: 72, resolveHours: 168 },
      phases: [
        {
          phase: 'acknowledge',
          dueAt: '2026-05-01T01:00:00.000Z',
          metAt: '2026-04-30T05:00:00.000Z',
          state: 'met',
          lateByHours: null,
          remainingHours: null,
        },
        {
          phase: 'respond',
          dueAt: '2026-05-03T01:00:00.000Z',
          metAt: null,
          state: 'pending',
          lateByHours: null,
          remainingHours: 30,
        },
        {
          phase: 'resolve',
          dueAt: '2026-05-07T01:00:00.000Z',
          metAt: null,
          state: 'not_started',
          lateByHours: null,
          remainingHours: null,
        },
      ],
      breached: false,
      escalation: 0,
      summary: 'Tenggat normal untuk kategori tunggu.',
    },
    responses: [
      {
        id: '0192f0d0-0000-7000-8000-000000000030',
        kind: 'initial',
        body: 'Kami sudah menurunkan petugas untuk mengecek headway.',
        evidenceUrls: ['https://dishub.go.id/bukti'],
        institutionId: '0192f0d0-0000-7000-8000-000000000040',
        institutionName: 'Dishub Kota',
        authorDisplayName: null,
        correctsResponseId: null,
        publishedAt: '2026-04-30T06:00:00.000Z',
        attestation: {
          signed: true,
          status: 'verified',
          bodyDigest: 'a'.repeat(64),
          signingKeyId: 'key-1',
          keyFingerprint: 'ABCD1234',
          algorithm: 'ed25519',
          signedAt: '2026-04-30T06:00:00.000Z',
          message: 'Tanda tangan sah.',
        },
      },
    ],
    verifications: [
      {
        id: '0192f0d0-0000-7000-8000-000000000050',
        method: 'field_inspection',
        verdict: 'confirmed',
        verifierKind: 'independent_institution',
        verifierLabel: 'Ombudsman',
        note: null,
        evidenceUrls: [],
        verifiedAt: '2026-04-30T07:00:00.000Z',
      },
    ],
    resolution: {
      outcome: 'undecided',
      reason: 'Belum ada bukti perbaikan headway.',
      supporting: 1,
      refuting: 0,
      inconclusive: 2,
      conflicts: [],
      cautions: [],
    },
    caveats: [],
  };
  return { ...base, ...overrides };
}

describe('evidence readout labels', () => {
  it('maps bands and dimensions to Indonesian words', () => {
    expect(bandLabel('moderate')).toBe('sedang');
    expect(bandLabel('tidak-dikenal')).toBe('tidak-dikenal');
    expect(dimensionLabel('corroboration')).toBe('Dukungan independen');
    expect(impactLabel('service_stopped')).toBe('layanan berhenti');
    expect(milestoneLabel('claimed_resolved')).toBe('Diklaim selesai');
    expect(milestoneLabel('tahap_baru')).toBe('tahap baru');
    expect(responseKindLabel('closure_claim')).toBe('Klaim selesai');
    expect(verdictLabel('refuted')).toBe('membantah');
  });

  it('formats percentages and digests without inventing values', () => {
    expect(percentText(0.426)).toBe('43%');
    expect(percentText(Number.NaN)).toBe('—');
    expect(scorePercent(-1)).toBe(0);
    expect(scorePercent(2)).toBe(100);
    expect(shortDigest('sha256:abcdef0123456789')).toBe('abcdef012345');
    expect(shortDigest('abc', 12)).toBe('abc');
  });

  it('describes the benchmark only from resolved data', () => {
    const resolved = pack();
    expect(benchmarkHeadline(resolved)).toBe('Janji 10 menit · ambang 15 menit');
    expect(benchmarkCaption(resolved)).toBe('Dokumen versi v2 per halte');

    const unavailable = pack({
      benchmark: {
        status: 'unavailable',
        reason: 'not_verified',
        message: 'Dokumen ada tetapi belum diverifikasi.',
        considered: 2,
      },
    });
    expect(benchmarkHeadline(unavailable)).toBe('Tanpa janji layanan');
    expect(benchmarkCaption(unavailable)).toBe(
      'Ada dokumen janji layanan, tetapi belum terverifikasi.',
    );
    expect(benchmarkReasonText('tidak_ada')).toBe(
      'Janji layanan tidak tersedia untuk periode ini.',
    );
  });

  it('describes quality honestly at each band', () => {
    expect(qualityVerdictText(pack())).toBe('Bukti cukup untuk indikasi, bukan kesimpulan final.');
    expect(qualityLimitingText(pack())).toBe('Penentu terlemah: kekuatan bukti');
    const high = pack();
    expect(qualityVerdictText({ ...high, quality: { ...high.quality, band: 'high' } })).toBe(
      'Bukti cukup untuk menyimpulkan selisih.',
    );
    expect(qualityVerdictText({ ...high, quality: { ...high.quality, band: 'low' } })).toBe(
      'Bukti belum cukup untuk menyimpulkan apa pun.',
    );
  });

  it('suggests one concrete action only when evidence is thin', () => {
    expect(qualityActionText(pack())).toBeNull();
    const thin = pack();
    expect(
      qualityActionText({ ...thin, quality: { ...thin.quality, band: 'very_low' } }),
    ).toContain('Laporan tetap boleh dikirim');
    expect(qualityActionText({ ...thin, quality: { ...thin.quality, band: 'low' } })).not.toBeNull();
  });

  it('explains which day scope the benchmark was resolved against', () => {
    expect(dayScopeLabel('holiday')).toBe('hari libur');
    expect(dayScopeLabel('luar_biasa')).toBe('luar_biasa');
    expect(dayScopeNote(pack())).toBe('Tanggal ini hari kerja.');

    const holiday = pack({ dayScope: 'holiday', holidayName: 'Natal' });
    expect(dayScopeNote(holiday)).toBe('Tanggal ini hari libur: Natal.');
    expect(dayScopeNote({ ...holiday, holidayName: null })).toBe(
      'Tanggal ini tercatat sebagai hari libur.',
    );
    expect(dayScopeNote({ ...holiday, dayScope: 'weekend' })).toBe('Tanggal ini akhir pekan.');
  });

  it('summarises context and provenance', () => {
    expect(contextSummary(pack())).toBe('Tidak ada pengumuman operasional pada periode ini.');
    expect(provenanceLine(pack())).toBe('m3.2 · 42 baris · data abcdef0123');
    const bare = pack({ snapshot: null });
    expect(provenanceLine(bare)).toBe('Dihitung 2026-05-01 03:00');
  });
});

describe('case file readout', () => {
  it('phrases SLA phases per state', () => {
    const sla = caseFile().sla;
    if (sla === null) {
      throw new Error('fixture harus punya SLA');
    }
    expect(slaPhaseLabel('acknowledge')).toBe('Pengakuan');
    expect(slaStateLabel('met_late')).toBe('terlambat');
    expect(slaPhaseValue(phaseAt(sla, 0))).toBe('tepat waktu');
    expect(slaPhaseValue(phaseAt(sla, 1))).toBe('sisa 30 jam');
    expect(slaPhaseValue(phaseAt(sla, 2))).toBe('belum dihitung');
    expect(
      slaPhaseValue({ ...phaseAt(sla, 1), state: 'overdue', lateByHours: 12 }),
    ).toBe('lewat 12 jam');
    expect(slaHeadline(caseFile())).toBe('Akui 24 j · tanggap 72 j · selesai 168 j');
  });

  it('flags breached SLA without changing the targets', () => {
    const breached = caseFile();
    const sla = breached.sla;
    if (sla === null) {
      throw new Error('fixture harus punya SLA');
    }
    expect(slaHeadline({ ...breached, sla: { ...sla, breached: true } })).toContain(
      'tenggat terlampaui',
    );
    expect(slaHeadline({ ...breached, sla: null })).toBeNull();
  });

  it('reports milestone progress and next step', () => {
    const file = caseFile();
    expect(milestoneProgress(file)).toBe(0.4);
    expect(
      milestoneProgress({ ...file, milestones: { ...file.milestones, progress: 3 } }),
    ).toBe(1);
    expect(nextMilestoneText(file)).toBe('Tahap berikutnya: ditanggapi.');
    expect(
      nextMilestoneText({
        ...file,
        milestones: { ...file.milestones, terminal: 'resolved', progress: 1 },
      }),
    ).toBe('Kasus sudah berakhir.');
  });

  it('describes resolution and attestation', () => {
    const file = caseFile();
    expect(outcomeLabel(file.resolution.outcome)).toBe('Klaim belum terbukti');
    expect(outcomeTone(file.resolution.outcome)).toBe('pending');
    expect(outcomeTone('verified')).toBe('verified');
    expect(outcomeTone('disputed')).toBe('alert');
    expect(resolutionCounts(file)).toBe('1 menguatkan · 0 membantah · 2 belum simpul');

    const attestation = file.responses[0]?.attestation;
    if (attestation === null || attestation === undefined) {
      throw new Error('fixture harus punya atestasi');
    }
    expect(attestationLabel(attestation)).toBe('Tertanda tangan');
    expect(attestationTone(attestation)).toBe('verified');
    expect(attestationTone({ ...attestation, status: 'unsigned' })).toBe('pending');
    expect(attestationTone({ ...attestation, status: 'payload_mismatch' })).toBe('alert');
    expect(attestationLabel({ ...attestation, status: 'structural_invalid' })).toBe(
      'Tanda tangan rusak',
    );
  });
});

describe('evidence guards', () => {
  it('accepts a well formed evidence pack', () => {
    expect(evidencePackSchema.safeParse(pack()).success).toBe(true);
  });

  it('rejects packs with missing dimensions or an unknown band', () => {
    const four = pack();
    expect(
      evidencePackSchema.safeParse({
        ...four,
        quality: { ...four.quality, dimensions: four.quality.dimensions.slice(0, 4) },
      }).success,
    ).toBe(false);

    const badBand = pack();
    expect(
      evidencePackSchema.safeParse({
        ...badBand,
        quality: { ...badBand.quality, band: 'luar_biasa' },
      }).success,
    ).toBe(false);
  });

  it('rejects a resolved benchmark without a source document', () => {
    const source = pack();
    const benchmark = source.benchmark;
    if (benchmark.status !== 'resolved') {
      throw new Error('fixture harus resolved');
    }
    expect(
      evidencePackSchema.safeParse({
        ...source,
        benchmark: { ...benchmark, sourceDocumentUrl: '' },
      }).success,
    ).toBe(false);
  });

  it('accepts a well formed case file', () => {
    expect(caseFileSchema.safeParse(caseFile()).success).toBe(true);
  });

  it('rejects case files with unknown milestones or bad verdicts', () => {
    const file = caseFile();
    expect(
      caseFileSchema.safeParse({
        ...file,
        milestones: { ...file.milestones, entries: [{ ...file.milestones.entries[0], key: 'x' }] },
      }).success,
    ).toBe(false);

    const verification = file.verifications[0];
    if (verification === undefined) {
      throw new Error('fixture harus punya verifikasi');
    }
    expect(
      caseFileSchema.safeParse({
        ...file,
        verifications: [{ ...verification, verdict: 'mungkin' }],
      }).success,
    ).toBe(false);
  });

  it('rejects non objects', () => {
    expect(evidencePackSchema.safeParse(null).success).toBe(false);
    expect(caseFileSchema.safeParse('teks').success).toBe(false);
  });
});
