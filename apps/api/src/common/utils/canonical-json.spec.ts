import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const value = {
      z: 1,
      a: { d: 4, c: [{ b: 2, a: 1 }] },
    };
    expect(canonicalJson(value)).toBe('{"a":{"c":[{"a":1,"b":2}],"d":4},"z":1}');
  });

  it('produces the same output for objects with different insertion order', () => {
    const left = { stopCode: 'BMS-A12', qr: { epoch: '202610', keyId: 'k1' } };
    const right = { qr: { keyId: 'k1', epoch: '202610' }, stopCode: 'BMS-A12' };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('omits undefined object properties and normalizes undefined array items', () => {
    expect(canonicalJson({ a: undefined, b: [1, undefined, 3] })).toBe('{"b":[1,null,3]}');
  });

  it('rejects non-JSON values instead of silently changing the hash input', () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson({ value: new Date() })).toThrow(TypeError);
    expect(() => canonicalJson({ value: 1n })).toThrow(TypeError);
  });
});
