import { describe, expect, it } from 'vitest';
import {
  PROVENANCE_SCHEMA_VERSION,
  buildProvenance,
  canonicalDataset,
  canonicalObservationLine,
  datasetShape,
  parametersFingerprint,
  readRecipeParameters,
  recipeParameter,
  reproducibilityCaveats,
  reproducibilitySteps,
  sourceLabel,
  summariseProvenance,
  verifyReproducibility,
  type ObservationRow,
  type ProvenanceInput,
} from './provenance';

function row(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    day: '2026-10-12',
    hour: 7,
    outcome: 'boarded',
    durationS: 900,
    deviceDayHash: 'a'.repeat(64),
    qualityFlags: [],
    ...overrides,
  };
}

describe('canonicalObservationLine', () => {
  it('separates fields with tabs and zero pads the hour', () => {
    const line = canonicalObservationLine(row({ hour: 7 }));
    expect(line.split('\t')).toEqual([
      '2026-10-12',
      '07',
      'boarded',
      '900',
      'a'.repeat(64),
      '',
    ]);
  });

  it('sorts and dedupes quality flags', () => {
    const line = canonicalObservationLine(
      row({ qualityFlags: ['simulated', 'low_accuracy', 'simulated'] }),
    );
    expect(line.endsWith('low_accuracy|simulated')).toBe(true);
  });

  it('normalises non integer durations deterministically', () => {
    const line = canonicalObservationLine(row({ durationS: 900.4567 }));
    expect(line).toContain('\t900.457\t');
  });

  it('clamps an out of range hour', () => {
    expect(canonicalObservationLine(row({ hour: 99 })).split('\t')[1]).toBe('23');
    expect(canonicalObservationLine(row({ hour: -5 })).split('\t')[1]).toBe('00');
  });

  it('truncates an over long device hash instead of letting it change length', () => {
    const line = canonicalObservationLine(row({ deviceDayHash: 'b'.repeat(100) }));
    expect(line.split('\t')[4]).toHaveLength(64);
  });
});

describe('canonicalDataset', () => {
  it('is stable regardless of input order', () => {
    const rows = [row({ hour: 9 }), row({ hour: 7 }), row({ hour: 8 })];
    expect(canonicalDataset(rows)).toBe(canonicalDataset([...rows].reverse()));
  });

  it('changes when a single duration changes', () => {
    const base = [row(), row({ hour: 8 })];
    const mutated = [row(), row({ hour: 8, durationS: 901 })];
    expect(canonicalDataset(base)).not.toBe(canonicalDataset(mutated));
  });

  it('returns an empty string for no rows', () => {
    expect(canonicalDataset([])).toBe('');
  });

  it('keeps duplicate rows so multiplicity affects the digest', () => {
    const single = canonicalDataset([row()]);
    const doubled = canonicalDataset([row(), row()]);
    expect(single).not.toBe(doubled);
  });
});

describe('datasetShape', () => {
  it('counts distinct days and hours', () => {
    const shape = datasetShape([
      row({ day: '2026-10-12', hour: 7 }),
      row({ day: '2026-10-12', hour: 8 }),
      row({ day: '2026-10-14', hour: 7 }),
    ]);
    expect(shape.rows).toBe(3);
    expect(shape.days).toBe(2);
    expect(shape.hours).toBe(2);
    expect(shape.firstDay).toBe('2026-10-12');
    expect(shape.lastDay).toBe('2026-10-14');
  });

  it('handles an empty dataset', () => {
    expect(datasetShape([])).toEqual({
      rows: 0,
      days: 0,
      hours: 0,
      firstDay: null,
      lastDay: null,
    });
  });
});

describe('buildProvenance', () => {
  function input(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
    return {
      subject: { kind: 'stop_estimate', ref: '0192f0c4-0000-7000-8000-0000000000c1' },
      methodVersion: 'km-v1',
      parameters: { tauSeconds: 2700, iterations: 1000, seed: 1 },
      dataset: {
        canonical: 'x',
        digestHex: 'ab'.repeat(32),
        rows: 42,
        firstDay: '2026-10-12',
        lastDay: '2026-10-18',
      },
      outputDigestHex: 'cd'.repeat(32),
      agent: { id: 'hadir:api/estimator', role: 'software', label: 'Estimator HADIR' },
      activityStart: '2026-10-19T00:00:00.000Z',
      activityEnd: '2026-10-19T00:00:01.000Z',
      sources: [],
      ...overrides,
    };
  }

  it('uses a versioned schema', () => {
    expect(buildProvenance(input()).schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
  });

  it('emits PROV-O typed entities, activity and agents', () => {
    const document = buildProvenance(input());
    expect(document.entities).toHaveLength(2);
    expect(document.entities.every((entity) => entity.provType === 'prov:Entity')).toBe(true);
    expect(document.activity.provType).toBe('prov:Activity');
    expect(document.agents[0]?.provType).toBe('prov:Agent');
  });

  it('links the output entity to the dataset entity', () => {
    const document = buildProvenance(input());
    const output = document.entities.find((entity) => entity.id.includes('output/'));
    expect(output?.derivedFrom).toHaveLength(1);
    expect(output?.derivedFrom[0]).toContain('dataset/');
    expect(output?.generatedBy).toBe(document.activity.id);
  });

  it('prefixes digests with the algorithm', () => {
    const document = buildProvenance(input());
    expect(document.reproducibility.datasetDigest).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(document.reproducibility.outputDigest).toBe(`sha256:${'cd'.repeat(32)}`);
  });

  it('records the parameter snapshot verbatim', () => {
    const document = buildProvenance(input());
    expect(document.reproducibility.parameters).toEqual({
      tauSeconds: 2700,
      iterations: 1000,
      seed: 1,
    });
  });

  it('derives the window from the dataset days', () => {
    const document = buildProvenance(input());
    expect(document.reproducibility.window.start).toBe('2026-10-12T00:00:00.000Z');
    expect(document.reproducibility.window.end).toBe('2026-10-18T23:59:59.999Z');
  });

  it('carries the source list into the activity inputs', () => {
    const document = buildProvenance(
      input({
        sources: [
          { kind: 'service_commitment', ref: 'commitment:abc', retrievedAt: null, url: null },
          { kind: 'gtfs_snapshot', ref: 'gtfs:2026-10-18', retrievedAt: null, url: null },
        ],
      }),
    );
    expect(document.activity.used).toContain('commitment:abc');
    expect(document.activity.used).toContain('gtfs:2026-10-18');
    expect(document.sources).toHaveLength(2);
  });

  it('always publishes reproducibility steps and caveats', () => {
    const document = buildProvenance(input());
    expect(document.reproducibility.steps.length).toBeGreaterThanOrEqual(6);
    expect(document.reproducibility.caveats.length).toBeGreaterThanOrEqual(3);
  });
});

describe('reproducibilitySteps', () => {
  it('names the method version', () => {
    expect(reproducibilitySteps('km-v2').join(' ')).toContain('km-v2');
  });

  it('instructs comparing digests before trusting a result', () => {
    const text = reproducibilitySteps('km-v1').join(' ');
    expect(text).toContain('datasetDigest');
    expect(text).toContain('outputDigest');
  });
});

describe('reproducibilityCaveats', () => {
  it('states that provenance is not truth', () => {
    expect(reproducibilityCaveats().join(' ')).toContain('bukan kebenaran isi');
  });
});

describe('verifyReproducibility', () => {
  const recipe = {
    methodVersion: 'km-v1',
    parameters: { tauSeconds: 2700, iterations: 1000 },
    datasetDigest: `sha256:${'ab'.repeat(32)}`,
    outputDigest: `sha256:${'cd'.repeat(32)}`,
    inputRows: 42,
    window: { start: '2026-10-12T00:00:00.000Z', end: '2026-10-18T23:59:59.999Z' },
    steps: [],
    caveats: [],
  };

  it('accepts an identical re run', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v1',
      datasetDigest: 'ab'.repeat(32),
      outputDigest: 'cd'.repeat(32),
      inputRows: 42,
      parameters: { tauSeconds: 2700, iterations: 1000 },
    });
    expect(verdict.reproducible).toBe(true);
    expect(verdict.differences).toEqual([]);
  });

  it('flags a changed dataset digest', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v1',
      datasetDigest: 'ef'.repeat(32),
    });
    expect(verdict.reproducible).toBe(false);
    expect(verdict.differences[0]).toContain('datasetDigest');
  });

  it('flags a changed method version', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v2',
      datasetDigest: 'ab'.repeat(32),
    });
    expect(verdict.differences.join(' ')).toContain('methodVersion');
  });

  it('flags a changed parameter', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v1',
      datasetDigest: 'ab'.repeat(32),
      parameters: { tauSeconds: 3600, iterations: 1000 },
    });
    expect(verdict.differences.join(' ')).toContain('parameters.tauSeconds');
  });

  it('flags a changed row count', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v1',
      datasetDigest: 'ab'.repeat(32),
      inputRows: 43,
    });
    expect(verdict.differences.join(' ')).toContain('inputRows');
  });

  it('respects base64 style digest input by normalising formatting', () => {
    const verdict = verifyReproducibility(recipe, {
      methodVersion: 'km-v1',
      datasetDigest: 'AB'.repeat(32),
    });
    expect(verdict.reproducible).toBe(true);
  });
});

describe('parametersFingerprint', () => {
  it('is order independent', () => {
    expect(parametersFingerprint({ b: 2, a: 1 })).toBe(parametersFingerprint({ a: 1, b: 2 }));
  });

  it('distinguishes different values', () => {
    expect(parametersFingerprint({ a: 1 })).not.toBe(parametersFingerprint({ a: 2 }));
  });

  it('handles an empty parameter set', () => {
    expect(parametersFingerprint({})).toBe('');
  });
});

describe('readRecipeParameters', () => {
  it('keeps only scalar values', () => {
    const parsed = readRecipeParameters({
      a: 1,
      b: 'x',
      c: true,
      d: null,
      e: { nested: 1 },
      f: [1, 2],
    });
    expect(parsed).toEqual({ a: 1, b: 'x', c: true, d: null });
  });
});

describe('recipeParameter', () => {
  it('reads a string or number parameter', () => {
    const recipe = {
      methodVersion: 'km-v1',
      parameters: { seed: 7, label: 'x' },
      datasetDigest: 'sha256:aa',
      outputDigest: 'sha256:bb',
      inputRows: 1,
      window: { start: '2026-10-12T00:00:00.000Z', end: '2026-10-12T23:59:59.999Z' },
      steps: [],
      caveats: [],
    };
    expect(recipeParameter(recipe, 'seed')).toBe(7);
    expect(recipeParameter(recipe, 'label')).toBe('x');
    expect(recipeParameter(recipe, 'missing')).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('labels every source kind in Indonesian', () => {
    expect(sourceLabel('citizen_observation')).toContain('observasi warga');
    expect(sourceLabel('service_commitment')).toContain('janji layanan');
    expect(sourceLabel('gtfs_snapshot')).toContain('GTFS');
  });
});

describe('summariseProvenance', () => {
  it('produces a short readable summary', () => {
    const document = buildProvenance({
      subject: { kind: 'stop_estimate', ref: 'stop-1' },
      methodVersion: 'km-v1',
      parameters: { seed: 1 },
      dataset: {
        canonical: 'x',
        digestHex: 'ab'.repeat(32),
        rows: 5,
        firstDay: '2026-10-12',
        lastDay: '2026-10-13',
      },
      outputDigestHex: 'cd'.repeat(32),
      agent: { id: 'hadir:api', role: 'software', label: 'API' },
      activityStart: '2026-10-14T00:00:00.000Z',
      activityEnd: '2026-10-14T00:00:01.000Z',
      sources: [],
    });
    const lines = summariseProvenance(document);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('km-v1');
    expect(lines[2]).toContain('sha256:');
  });
});
