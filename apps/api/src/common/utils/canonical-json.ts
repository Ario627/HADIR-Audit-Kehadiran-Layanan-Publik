type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function fail(path: string, reason: string): never {
  throw new TypeError(`Nilai pada ${path} ${reason}.`);
}

function normalize(value: unknown, path: string): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(path, 'harus berupa angka finite');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      item === undefined ? null : normalize(item, `${path}[${index}]`),
    );
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(path, 'harus berupa objek JSON biasa');
    }
    const record = value as Record<string, unknown>;
    const output: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) {
        continue;
      }
      output[key] = normalize(item, `${path}.${key}`);
    }
    return output;
  }
  fail(path, 'bukan tipe JSON yang didukung');
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(normalize(value, '$'));
  if (serialized === undefined) {
    throw new TypeError('Nilai tidak dapat diserialisasi sebagai JSON.');
  }
  return serialized;
}
