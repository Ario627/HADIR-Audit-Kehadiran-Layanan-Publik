import type { AuditEntry, AuditRepository } from '../../db/repositories/audit.repository';
import { AuditService } from './audit.service';
import { toAuditActor } from './audit.actor';
import { sanitizeAuditPayload, sanitizeAuditString } from './audit.payload';

const DEVICE_HASH = 'a'.repeat(64);

interface Capture {
  entries: AuditEntry[];
}

function buildRepository(capture: Capture, fail = false): AuditRepository {
  return {
    append: async (entry: AuditEntry) => {
      if (fail) {
        throw new Error('audit storage down');
      }
      capture.entries.push(entry);
    },
  } as unknown as AuditRepository;
}

function buildService(capture: Capture, fail = false): AuditService {
  return new AuditService(buildRepository(capture, fail));
}

describe('sanitizeAuditString', () => {
  it('drops carriage returns and line feeds', () => {
    expect(sanitizeAuditString('a\r\nb\nc')).toBe('abc');
  });

  it('drops every other control character', () => {
    expect(sanitizeAuditString('a\u0000b\u0007c\u001bd')).toBe('abcd');
  });

  it('drops unicode line separators that break log parsers', () => {
    expect(sanitizeAuditString('a\u2028b\u2029c')).toBe('abc');
  });

  it('keeps ordinary text intact', () => {
    expect(sanitizeAuditString('halte ump -7.41')).toBe('halte ump -7.41');
  });

  it('bounds the length', () => {
    expect(sanitizeAuditString('x'.repeat(1_000)).length).toBe(256);
  });
});

describe('sanitizeAuditPayload', () => {
  it('refuses prototype pollution keys', () => {
    const dirty = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
    const clean = sanitizeAuditPayload(dirty);

    expect(clean.ok).toBe(1);
    expect(clean.__proto__).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps only bounded primitives', () => {
    const clean = sanitizeAuditPayload({
      text: 'halo',
      count: 3,
      flag: true,
      missing: undefined,
      fn: () => undefined,
      huge: Number.POSITIVE_INFINITY,
    });

    expect(clean.text).toBe('halo');
    expect(clean.count).toBe(3);
    expect(clean.flag).toBe(true);
    expect(clean.missing).toBeNull();
    expect(clean.fn).toBeNull();
    expect(clean.huge).toBeNull();
  });

  it('caps key count', () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) {
      wide[`k${index}`] = index;
    }
    expect(Object.keys(sanitizeAuditPayload(wide)).length).toBe(16);
  });

  it('stops descending past the depth limit', () => {
    const deep = { a: { b: { c: { d: { e: 'too far' } } } } };
    const clean = sanitizeAuditPayload(deep);

    expect(JSON.stringify(clean)).not.toContain('too far');
    expect(JSON.stringify(clean)).toBe('{"a":{"b":{"c":{"d":null}}}}');
  });
});

describe('toAuditActor', () => {
  it('pseudonymises a citizen as its device hash', () => {
    expect(toAuditActor({ kind: 'citizen', deviceHash: DEVICE_HASH })).toEqual({
      actorType: 'citizen',
      actorId: DEVICE_HASH,
    });
  });

  it('records the partner user id', () => {
    expect(
      toAuditActor({ kind: 'partner', userId: 'u1', institutionId: 'i1', role: 'responder' }),
    ).toEqual({ actorType: 'partner', actorId: 'u1' });
  });

  it('falls back to the system actor', () => {
    expect(toAuditActor(null)).toEqual({ actorType: 'system', actorId: null });
  });
});

describe('AuditService', () => {
  it('writes the record with a null-safe shape', async () => {
    const capture: Capture = { entries: [] };
    await buildService(capture).record({ action: 'report.create', objectType: 'report' });

    expect(capture.entries[0]).toMatchObject({
      actorType: 'system',
      actorId: null,
      action: 'report.create',
      objectId: null,
      requestId: null,
      ipHash: null,
    });
  });

  it('never throws when the audit store is down', async () => {
    const capture: Capture = { entries: [] };
    await expect(
      buildService(capture, true).record({ action: 'report.create', objectType: 'report' }),
    ).resolves.toBeUndefined();
    expect(capture.entries).toHaveLength(0);
  });

  it('funnels every denial into one action with the attempt preserved', async () => {
    const capture: Capture = { entries: [] };
    await buildService(capture).denial({
      attempted: 'report.corroborate',
      reason: 'self_corroborate',
      objectType: 'report',
      objectId: 'RPT-1',
    });

    expect(capture.entries[0]).toMatchObject({
      action: 'authz.denied',
      objectId: 'RPT-1',
      payload: { attempted: 'report.corroborate', reason: 'self_corroborate' },
    });
  });

  it('cannot let caller payload overwrite the denial reason', async () => {
    const capture: Capture = { entries: [] };
    await buildService(capture).denial({
      attempted: 'report.partner_action',
      reason: 'partner_mode_disabled',
      objectType: 'report',
      payload: { reason: 'spoofed', attempted: 'spoofed' },
    });

    expect(capture.entries[0]?.payload).toMatchObject({
      reason: 'partner_mode_disabled',
      attempted: 'report.partner_action',
    });
  });

  it('scrubs the payload before it reaches storage', async () => {
    const capture: Capture = { entries: [] };
    await buildService(capture).record({
      action: 'report.create',
      objectType: 'report',
      payload: { note: 'baris1\r\nbaris2' },
    });

    expect(capture.entries[0]?.payload.note).toBe('baris1baris2');
  });
});
