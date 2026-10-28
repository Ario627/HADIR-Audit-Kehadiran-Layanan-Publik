import { describe, expect, it } from 'vitest';
import {
  coverageSummarySchema,
  estimateSchema,
  methodologySchema,
  routeStopListSchema,
  runwayListSchema,
  stopListSchema,
  triageResultSchema,
  reportDetailSchema,
  createReportResultSchema,
  corroborateResultSchema,
  closureResultSchema,
  reportListSchema,
  runwayEventsSchema,
  uploadTicketSchema,
  storedUploadSchema,
} from './guards';

const STOP = {
  id: '018bcfe5-0000-4000-8000-000000000001',
  code: 'BMS-A12',
  name: 'Halte UMP',
  location: { lat: -7.4, lon: 109.2 },
  status: 'active',
  isDemo: false,
  routes: [
    {
      id: '018bcfe5-0000-4000-8000-0000000000aa',
      code: 'K3A',
      name: 'Koridor 3A',
      promisedHeadwayPeakMin: 15,
      headwaySourceUrl: 'https://dinhub.example.go.id/spm',
    },
  ],
};

const COVERAGE = {
  period: '7d',
  stops: [
    {
      stopId: STOP.id,
      stopCode: STOP.code,
      stopName: STOP.name,
      n: 34,
      devices: 12,
      days: 6,
      clusters: 9,
      hoursCovered: 8,
      level: 'strong',
    },
  ],
};

const METHODOLOGY = {
  methodVersion: 'est-2026-10-26.1',
  updatedAt: '2026-10-26T00:00:00.000Z',
  primaryEstimand: 'Lama tunggu yang dialami.',
  secondaryEstimand: 'Lama tunggu sampai bus datang.',
  steps: [{ order: 1, title: 'Kumpulkan', detail: 'Episode valid dikumpulkan.' }],
  clusterUnit: 'hari-jam per halte',
  clusterRationale: 'Penunggu di jam yang sama menunggu bus yang sama.',
  thresholds: { excessMultiplier: 1.25, idealWaitFormula: 'headway / 2' },
  limitations: ['Angka mencerminkan penunggu yang mencatat.'],
  generatedAt: '2026-10-26T00:00:00.000Z',
};

describe('stopListSchema', () => {
  it('menerima daftar halte yang sesuai kontrak', () => {
    const parsed = stopListSchema.safeParse([STOP]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]?.routes[0]?.promisedHeadwayPeakMin).toBe(15);
    }
  });

  it('menolak bentuk yang bukan larik', () => {
    expect(stopListSchema.safeParse({ data: [STOP] }).success).toBe(false);
    expect(stopListSchema.safeParse(null).success).toBe(false);
  });

  it('menolak status halte yang tidak dikenal', () => {
    expect(stopListSchema.safeParse([{ ...STOP, status: 'deleted' }]).success).toBe(false);
  });

  it('menolak koordinat di luar rentang bumi', () => {
    expect(stopListSchema.safeParse([{ ...STOP, location: { lat: 91, lon: 0 } }]).success).toBe(
      false,
    );
  });

  it('tidak membiarkan properti tambahan masuk ke hasil', () => {
    const parsed = stopListSchema.safeParse([{ ...STOP, admin: true }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.hasOwn(parsed.data[0] ?? {}, 'admin')).toBe(false);
    }
  });
});

describe('coverageSummarySchema', () => {
  it('menerima ringkasan cakupan', () => {
    const parsed = coverageSummarySchema.safeParse(COVERAGE);
    expect(parsed.success).toBe(true);
  });

  it('menolak level bukti dan jam yang tidak masuk akal', () => {
    const badLevel = { ...COVERAGE, stops: [{ ...COVERAGE.stops[0], level: 'keren' }] };
    expect(coverageSummarySchema.safeParse(badLevel).success).toBe(false);

    const badHours = { ...COVERAGE, stops: [{ ...COVERAGE.stops[0], hoursCovered: 30 }] };
    expect(coverageSummarySchema.safeParse(badHours).success).toBe(false);
  });

  it('menolak jendela periode yang tidak dikenal', () => {
    expect(coverageSummarySchema.safeParse({ ...COVERAGE, period: '90d' }).success).toBe(false);
  });
});

describe('methodologySchema', () => {
  it('menerima metodologi lengkap', () => {
    expect(methodologySchema.safeParse(METHODOLOGY).success).toBe(true);
  });

  it('menolak metodologi tanpa batasan', () => {
    expect(methodologySchema.safeParse({ ...METHODOLOGY, limitations: [] }).success).toBe(false);
    expect(methodologySchema.safeParse({ ...METHODOLOGY, limitations: [''] }).success).toBe(false);
  });

  it('menolak versi metode kosong', () => {
    expect(methodologySchema.safeParse({ ...METHODOLOGY, methodVersion: '  ' }).success).toBe(false);
  });
});

const ESTIMATE = {
  stopId: '018bcfe5-0000-4000-8000-000000000002',
  stopCode: 'BMS-A12',
  routeId: null,
  window: { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z', label: '7d' },
  metrics: {
    n: 34,
    nEffective: 21.4,
    medianMin: 21,
    meanMin: 22.3,
    rmstMin: 24.1,
    p95Min: 41,
    ewtMin: 13.5,
    abandonRate: 0.18,
    fullRate: 0.06,
    cifAbandon: 0.24,
    timeToBoardRmstMin: 26.9,
    ci: { low: 18, high: 25, level: 0.9, method: 'cluster-bootstrap' },
  },
  promise: { headwayMin: 15, source: 'headway koridor', sourceUrl: 'https://contoh.go.id/spm' },
  evidence: 'strong',
  direction: 'excess',
  message: '34 catatan.',
  warnings: [],
  simulated: false,
  sample: { days: 6, devices: 12, clusters: 9, designEffect: 1.8, thresholdMin: 18.75 },
  computedAt: '2026-10-26T04:00:00.000Z',
  methodVersion: 'est-2026-10-26.1',
};

describe('estimateSchema', () => {
  it('menerima estimasi lengkap dan membuang properti tambahan', () => {
    const parsed = estimateSchema.safeParse({ ...ESTIMATE, rahasia: 'x' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metrics.ci?.level).toBe(0.9);
      expect(Object.hasOwn(parsed.data, 'rahasia')).toBe(false);
    }
  });

  it('menerima estimasi tanpa janji dan tanpa interval', () => {
    const parsed = estimateSchema.safeParse({
      ...ESTIMATE,
      promise: null,
      metrics: { ...ESTIMATE.metrics, ci: null, medianMin: null },
      evidence: 'none',
      direction: 'inconclusive',
    });
    expect(parsed.success).toBe(true);
  });

  it('menolak interval yang terbalik atau level di luar 0..1', () => {
    const reversed = { ...ESTIMATE, metrics: { ...ESTIMATE.metrics, ci: { low: 25, high: 18, level: 0.9, method: 'x' } } };
    expect(estimateSchema.safeParse(reversed).success).toBe(false);
    const badLevel = { ...ESTIMATE, metrics: { ...ESTIMATE.metrics, ci: { low: 18, high: 25, level: 1, method: 'x' } } };
    expect(estimateSchema.safeParse(badLevel).success).toBe(false);
  });

  it('menolak laju di luar 0..1 dan sampel negatif', () => {
    const badRate = { ...ESTIMATE, metrics: { ...ESTIMATE.metrics, abandonRate: 1.4 } };
    expect(estimateSchema.safeParse(badRate).success).toBe(false);
    const badSample = { ...ESTIMATE, sample: { ...ESTIMATE.sample, days: -1 } };
    expect(estimateSchema.safeParse(badSample).success).toBe(false);
  });

  it('menolak arah dan level yang tidak dikenal', () => {
    expect(estimateSchema.safeParse({ ...ESTIMATE, direction: 'bagus' }).success).toBe(false);
    expect(estimateSchema.safeParse({ ...ESTIMATE, evidence: 'keren' }).success).toBe(false);
  });

  it('menolak daftar warning yang kebanyakan', () => {
    const many = { ...ESTIMATE, warnings: Array.from({ length: 21 }, () => 'small_n') };
    expect(estimateSchema.safeParse(many).success).toBe(false);
  });
});

const ROUTE_STOPS = {
  route: {
    id: '018bcfe5-0000-4000-8000-0000000000aa',
    code: 'K3A',
    name: 'Koridor 3A',
    mode: 'brt',
    status: 'active',
    promisedHeadwayPeakMin: 15,
    promisedHeadwayOffMin: 20,
    headwaySourceUrl: 'https://dinhub.example.go.id/spm',
    headwayValidFrom: '2026-01-01',
    headwayValidTo: '2026-12-31',
    stopCount: 1,
  },
  stops: [
    {
      stopId: '018bcfe5-0000-4000-8000-000000000002',
      stopCode: 'BMS-A12',
      stopName: 'Halte UMP',
      direction: 0,
      seq: 0,
      status: 'active',
    },
  ],
};

describe('routeStopListSchema', () => {
  it('menerima koridor beserta urutan halte', () => {
    const parsed = routeStopListSchema.safeParse(ROUTE_STOPS);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stops[0]?.seq).toBe(0);
    }
  });

  it('menolak mode, status, dan arah yang tidak dikenal', () => {
    const badMode = { ...ROUTE_STOPS, route: { ...ROUTE_STOPS.route, mode: 'kereta' } };
    expect(routeStopListSchema.safeParse(badMode).success).toBe(false);
    const badStatus = { ...ROUTE_STOPS, route: { ...ROUTE_STOPS.route, status: 'libur' } };
    expect(routeStopListSchema.safeParse(badStatus).success).toBe(false);
    const badDirection = {
      ...ROUTE_STOPS,
      stops: [{ ...ROUTE_STOPS.stops[0], direction: 2 }],
    };
    expect(routeStopListSchema.safeParse(badDirection).success).toBe(false);
  });

  it('menolak janji headway nol', () => {
    const zero = { ...ROUTE_STOPS, route: { ...ROUTE_STOPS.route, promisedHeadwayPeakMin: 0 } };
    expect(routeStopListSchema.safeParse(zero).success).toBe(false);
  });
});

const RUNWAY = {
  routeId: '018bcfe5-0000-4000-8000-0000000000aa',
  routeCode: 'K3A',
  routeName: 'Koridor 3A',
  status: 'funded',
  urgency: 'watch',
  fundedUntil: '2026-12-31',
  daysRemaining: 88,
  sourceUrl: 'https://contoh.go.id/rup',
  decisionDoc: null,
  decisionDate: null,
  note: null,
  sanctions: ['Peringatan tertulis'],
  events: [
    {
      seq: 1,
      kind: 'funded',
      note: 'Dana terjamin sampai akhir tahun.',
      sourceUrl: 'https://contoh.go.id/rup',
      occurredAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  disclaimer: 'Tanggal adalah batas pendanaan yang dilaporkan, bukan prediksi.',
  simulated: false,
  computedAt: '2026-10-26T04:00:00.000Z',
};

describe('runwayListSchema', () => {
  it('menerima daftar runway tanpa memakai zod', () => {
    const parsed = runwayListSchema.safeParse([RUNWAY]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]?.events[0]?.kind).toBe('funded');
    }
  });

  it('menolak jenis event dan band urgensi yang tidak dikenal', () => {
    const badKind = {
      ...RUNWAY,
      events: [{ ...RUNWAY.events[0], kind: 'dibatalkan' }],
    };
    expect(runwayListSchema.safeParse([badKind]).success).toBe(false);
    expect(runwayListSchema.safeParse([{ ...RUNWAY, urgency: 'panik' }]).success).toBe(false);
  });

  it('menolak lebih dari lima sanksi dan tautan sumber yang kosong', () => {
    const many = { ...RUNWAY, sanctions: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(runwayListSchema.safeParse([many]).success).toBe(false);
    const broken = { ...RUNWAY, events: [{ ...RUNWAY.events[0], sourceUrl: '  ' }] };
    expect(runwayListSchema.safeParse([broken]).success).toBe(false);
  });
});

const TRIAGE = {
  sessionId: '018bcfe5-0000-7000-8000-0000000000aa',
  verdict: 'data_supports',
  headline: 'Pengukuran warga mendukung',
  body: 'Ada pengukuran di halte ini yang menunjukkan lama tunggu di atas janji.',
  actions: [
    { kind: 'monitor', label: 'Pantau dan ingatkan' },
    { kind: 'send_anyway', label: 'Tetap kirim laporan' },
  ],
  evidence: [
    {
      id: '018bcfe5-0000-4000-8000-0000000000bb',
      claim: 'SPM koridor 3A menjanjikan headway 15 menit',
      tier: 'T1',
      sourceUrl: 'https://dinhub.example.go.id/spm',
      retrievedAt: '2026-10-01T00:00:00.000Z',
      matchScore: 0.92,
      label: 'terkait',
    },
  ],
  connectors: { rup: 'ok', spm: 'unavailable' },
  rulesVersion: 'triage-v1',
  latencyMs: 140,
  reasons: ['ada pengukuran di atas ambang'],
  requiresConfirmation: true,
};

describe('triageResultSchema', () => {
  it('menerima hasil triase lengkap', () => {
    const parsed = triageResultSchema.safeParse(TRIAGE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.actions).toHaveLength(2);
      expect(parsed.data.connectors.spm).toBe('unavailable');
    }
  });

  it('menolak putusan dan aksi yang tidak dikenal', () => {
    expect(triageResultSchema.safeParse({ ...TRIAGE, verdict: 'bagus' }).success).toBe(false);
    const badAction = { ...TRIAGE, actions: [{ kind: 'kirim_wa', label: 'Kirim WA' }] };
    expect(triageResultSchema.safeParse(badAction).success).toBe(false);
  });

  it('menolak hasil tanpa aksi, karena tombol kirim harus selalu ada', () => {
    expect(triageResultSchema.safeParse({ ...TRIAGE, actions: [] }).success).toBe(false);
  });

  it('menolak konektor dengan status tak dikenal', () => {
    const bad = { ...TRIAGE, connectors: { rup: 'mungkin' } };
    expect(triageResultSchema.safeParse(bad).success).toBe(false);
  });

  it('menolak skor kecocokan di luar 0..1 dan tier tak dikenal', () => {
    const badScore = {
      ...TRIAGE,
      evidence: [{ ...TRIAGE.evidence[0], matchScore: 1.4 }],
    };
    expect(triageResultSchema.safeParse(badScore).success).toBe(false);
    const badTier = { ...TRIAGE, evidence: [{ ...TRIAGE.evidence[0], tier: 'T9' }] };
    expect(triageResultSchema.safeParse(badTier).success).toBe(false);
  });
});

const REPORT = {
  publicId: '123456',
  category: 'service_no_show',
  status: 'submitted',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  corroborationCount: 3,
  evidenceLevel: 'indication',
  createdAt: '2026-10-26T04:00:00.000Z',
  moderation: 'pending',
  text: 'Bus K3A tidak muncul antara pukul 07.10 dan 07.40.',
  authorityName: 'Dinas Perhubungan',
  evidenceScore: 0.35,
  resolvedAt: null,
  events: [
    {
      kind: 'submitted',
      actorType: 'citizen',
      note: null,
      createdAt: '2026-10-26T04:00:00.000Z',
    },
  ],
};

describe('reportDetailSchema', () => {
  it('menerima detail laporan publik', () => {
    const parsed = reportDetailSchema.safeParse(REPORT);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.publicId).toBe('123456');
      expect(parsed.data.events[0]?.note).toBeNull();
    }
  });

  it('menolak publicId pendek dan status tak dikenal', () => {
    expect(reportDetailSchema.safeParse({ ...REPORT, publicId: '123' }).success).toBe(false);
    expect(reportDetailSchema.safeParse({ ...REPORT, status: 'hilang' }).success).toBe(false);
  });

  it('menolak evidenceScore di luar 0..1 dan aktor tak dikenal', () => {
    expect(reportDetailSchema.safeParse({ ...REPORT, evidenceScore: 1.5 }).success).toBe(false);
    const badActor = {
      ...REPORT,
      events: [{ ...REPORT.events[0], actorType: 'alien' }],
    };
    expect(reportDetailSchema.safeParse(badActor).success).toBe(false);
  });

  it('menerima resolvedAt null maupun terisi', () => {
    expect(reportDetailSchema.safeParse({ ...REPORT, resolvedAt: null }).success).toBe(true);
    expect(
      reportDetailSchema.safeParse({ ...REPORT, resolvedAt: '2026-10-27T04:00:00.000Z' }).success,
    ).toBe(true);
  });
});

describe('createReportResultSchema', () => {
  it('menerima laporan beserta peringatan', () => {
    const parsed = createReportResultSchema.safeParse({
      report: REPORT,
      warnings: ['photo_upload_ignored'],
    });
    expect(parsed.success).toBe(true);
  });

  it('menolak peringatan yang bukan teks', () => {
    expect(createReportResultSchema.safeParse({ report: REPORT, warnings: [1] }).success).toBe(false);
  });
});

describe('corroborateResultSchema dan closureResultSchema', () => {
  it('menerima hasil dukungan', () => {
    const parsed = corroborateResultSchema.safeParse({ corroborationCount: 4, alreadyCounted: false });
    expect(parsed.success).toBe(true);
  });

  it('menolak jumlah dukungan negatif', () => {
    expect(
      corroborateResultSchema.safeParse({ corroborationCount: -1, alreadyCounted: false }).success,
    ).toBe(false);
  });

  it('menerima status penutupan dari server', () => {
    const parsed = closureResultSchema.safeParse({ status: 'verified_resolved', recorded: true });
    expect(parsed.success).toBe(true);
  });

  it('menolak status penutupan di luar enum', () => {
    expect(closureResultSchema.safeParse({ status: 'selesai', recorded: true }).success).toBe(false);
  });
});

const RUNWAY_EVENTS = [
  {
    seq: 1,
    kind: 'funded',
    note: 'Dana dicairkan.',
    sourceUrl: 'https://contoh.go.id/rup',
    occurredAt: '2026-02-01T00:00:00.000Z',
  },
];

describe('runwayEventsSchema', () => {
  it('menerima daftar event dan menolak jenis yang tidak dikenal', () => {
    expect(runwayEventsSchema.safeParse(RUNWAY_EVENTS).success).toBe(true);
    expect(runwayEventsSchema.safeParse([{ ...RUNWAY_EVENTS[0], kind: 'dibatalkan' }]).success).toBe(
      false,
    );
  });

  it('menolak seq nol dan tautan kosong', () => {
    expect(runwayEventsSchema.safeParse([{ ...RUNWAY_EVENTS[0], seq: 0 }]).success).toBe(false);
    expect(runwayEventsSchema.safeParse([{ ...RUNWAY_EVENTS[0], sourceUrl: ' ' }]).success).toBe(false);
  });
});

const REPORT_LIST_ITEM = {
  publicId: '123456',
  category: 'service_no_show',
  status: 'submitted',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  corroborationCount: 3,
  evidenceLevel: 'indication',
  createdAt: '2026-10-26T04:00:00.000Z',
};

describe('reportListSchema', () => {
  it('menerima daftar laporan milik perangkat', () => {
    const parsed = reportListSchema.safeParse([REPORT_LIST_ITEM]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]?.publicId).toBe('123456');
    }
  });

  it('menolak kategori, status, dan level bukti di luar kontrak', () => {
    expect(reportListSchema.safeParse([{ ...REPORT_LIST_ITEM, category: 'x' }]).success).toBe(false);
    expect(reportListSchema.safeParse([{ ...REPORT_LIST_ITEM, status: 'x' }]).success).toBe(false);
    expect(reportListSchema.safeParse([{ ...REPORT_LIST_ITEM, evidenceLevel: 'x' }]).success).toBe(
      false,
    );
  });

  it('menolak publicId terlalu pendek dan jumlah berlebihan', () => {
    expect(reportListSchema.safeParse([{ ...REPORT_LIST_ITEM, publicId: '123' }]).success).toBe(false);
    const many = Array.from({ length: 101 }, () => REPORT_LIST_ITEM);
    expect(reportListSchema.safeParse(many).success).toBe(false);
  });
});

describe('triageEvidence targetPublicId', () => {
  it('menerima target yang sah dan membuang properti tambahan', () => {
    const parsed = triageResultSchema.safeParse({
      ...TRIAGE,
      evidence: [{ ...TRIAGE.evidence[0], targetPublicId: '123456' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.evidence[0]?.targetPublicId).toBe('123456');
    }
  });

  it('menolak target yang bukan public id', () => {
    const bad = {
      ...TRIAGE,
      evidence: [{ ...TRIAGE.evidence[0], targetPublicId: '../../etc' }],
    };
    expect(triageResultSchema.safeParse(bad).success).toBe(false);
  });

  it('menerima target null', () => {
    const parsed = triageResultSchema.safeParse({
      ...TRIAGE,
      evidence: [{ ...TRIAGE.evidence[0], targetPublicId: null }],
    });
    expect(parsed.success).toBe(true);
  });
});

const UPLOAD_TICKET = {
  uploadId: '018bcfe5-0000-7000-8000-0000000000cc',
  url: '/v1/uploads/018bcfe5-0000-7000-8000-0000000000cc',
  method: 'PUT',
  headers: { 'Content-Type': 'image/jpeg', 'X-Upload-Token': 'A'.repeat(43) },
  expiresAt: '2026-10-28T10:15:00.000Z',
};

describe('uploadTicketSchema', () => {
  it('menerima tiket unggah yang menunjuk ke endpoint sendiri', () => {
    const parsed = uploadTicketSchema.safeParse(UPLOAD_TICKET);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.method).toBe('PUT');
    }
  });

  it('menolak tautan ke host lain agar token tidak dikirim keluar', () => {
    const external = { ...UPLOAD_TICKET, url: 'https://jahat.example/collect' };
    expect(uploadTicketSchema.safeParse(external).success).toBe(false);
    const protocolRelative = { ...UPLOAD_TICKET, url: '//jahat.example/collect' };
    expect(uploadTicketSchema.safeParse(protocolRelative).success).toBe(false);
  });

  it('menolak metode selain PUT dan tiket tanpa token unggah', () => {
    expect(uploadTicketSchema.safeParse({ ...UPLOAD_TICKET, method: 'POST' }).success).toBe(false);
    expect(uploadTicketSchema.safeParse({ ...UPLOAD_TICKET, headers: {} }).success).toBe(false);
    const noToken = { ...UPLOAD_TICKET, headers: { 'Content-Type': 'image/jpeg' } };
    expect(uploadTicketSchema.safeParse(noToken).success).toBe(false);
    const badHeader = { ...UPLOAD_TICKET, headers: { 'X-Upload-Token': '' } };
    expect(uploadTicketSchema.safeParse(badHeader).success).toBe(false);
  });
});

describe('storedUploadSchema', () => {
  it('menerima hasil unggah dan menolak dimensi tidak wajar', () => {
    const ok = { uploadId: UPLOAD_TICKET.uploadId, mime: 'image/jpeg', width: 1200, height: 900 };
    expect(storedUploadSchema.safeParse(ok).success).toBe(true);
    expect(storedUploadSchema.safeParse({ ...ok, width: 0 }).success).toBe(true);
    expect(storedUploadSchema.safeParse({ ...ok, height: 99_999 }).success).toBe(false);
  });
});
