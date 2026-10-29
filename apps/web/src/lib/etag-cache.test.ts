import { beforeEach, describe, expect, it } from 'vitest';
import { clearEtags, forgetEtag, readCachedEnvelope, readEtag, rememberEtag } from './etag-cache';

beforeEach(() => {
  clearEtags();
});

describe('etag cache', () => {
  it('returns null for an unknown path', () => {
    expect(readEtag('/v1/stops')).toBeNull();
    expect(readCachedEnvelope('/v1/stops')).toBeNull();
  });

  it('remembers an etag and its body together', () => {
    rememberEtag('/v1/stops', '"abc"', { data: [1, 2] });

    expect(readEtag('/v1/stops')).toBe('"abc"');
    expect(readCachedEnvelope('/v1/stops')).toEqual({ data: [1, 2] });
  });

  it('replaces the previous entry instead of duplicating', () => {
    rememberEtag('/v1/stops', '"a"', { data: 1 });
    rememberEtag('/v1/stops', '"b"', { data: 2 });

    expect(readEtag('/v1/stops')).toBe('"b"');
    expect(readCachedEnvelope('/v1/stops')).toEqual({ data: 2 });
  });

  it('keeps paths independent', () => {
    rememberEtag('/v1/stops', '"a"', { data: 'a' });
    rememberEtag('/v1/runway', '"b"', { data: 'b' });

    expect(readCachedEnvelope('/v1/stops')).toEqual({ data: 'a' });
    expect(readCachedEnvelope('/v1/runway')).toEqual({ data: 'b' });
  });

  it('forgets one path without touching the others', () => {
    rememberEtag('/v1/stops', '"a"', { data: 'a' });
    rememberEtag('/v1/runway', '"b"', { data: 'b' });

    forgetEtag('/v1/stops');

    expect(readEtag('/v1/stops')).toBeNull();
    expect(readEtag('/v1/runway')).toBe('"b"');
  });

  it('evicts the oldest entry when full', () => {
    for (let index = 0; index < 70; index += 1) {
      rememberEtag(`/v1/x${index}`, `"${index}"`, { data: index });
    }

    expect(readEtag('/v1/x0')).toBeNull();
    expect(readEtag('/v1/x69')).toBe('"69"');
  });
});
