import { cell, columnIndex, parseAmount, parseCsv, splitKeywords } from './admin.csv';

describe('parseCsv', () => {
  it('splits simple rows and normalises headers', () => {
    const table = parseCsv('Satker,Nama Paket,TAHUN\nDinhub,Perbaikan Halte,2026');
    expect(table.header).toEqual(['satker', 'nama_paket', 'tahun']);
    expect(table.rows).toEqual([['Dinhub', 'Perbaikan Halte', '2026']]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const table = parseCsv('a,b\n"x,1","he said ""hi""\nthere"');
    expect(table.rows[0]).toEqual(['x,1', 'he said "hi"\nthere']);
  });

  it('normalises CRLF and CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\r1,2\r').rows).toEqual([['1', '2']]);
  });

  it('drops trailing blank lines', () => {
    expect(parseCsv('a\n1\n\n\n').rows).toEqual([['1']]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('\uFEFFsatker,nama_paket\nA,B').header).toEqual([
      'satker',
      'nama_paket',
    ]);
  });

  it('returns an empty table for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,b\n"unterminated,2')).toThrow();
  });

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,').rows[0]).toEqual(['1', '', '']);
  });
});

describe('columnIndex', () => {
  it('finds the first matching alias', () => {
    const header = ['nama_paket', 'satker'];
    expect(columnIndex(header, ['satker', 'kode_satker'])).toBe(1);
    expect(columnIndex(header, ['name', 'nama_paket'])).toBe(0);
  });

  it('returns minus one when nothing matches', () => {
    expect(columnIndex(['a'], ['b'])).toBe(-1);
  });
});

describe('cell', () => {
  it('trims and maps empty to null', () => {
    expect(cell([' a ', ''], 0)).toBe('a');
    expect(cell([' a ', ''], 1)).toBeNull();
  });

  it('returns null for negative indexes and missing columns', () => {
    expect(cell(['a'], -1)).toBeNull();
    expect(cell(['a'], 5)).toBeNull();
  });
});

describe('parseAmount', () => {
  it('parses plain integers and decimals', () => {
    expect(parseAmount('1500000')).toBe('1500000.00');
    expect(parseAmount('1500.5')).toBe('1500.50');
  });

  it('parses Indonesian grouping and decimal comma', () => {
    expect(parseAmount('1.500.000,75')).toBe('1500000.75');
    expect(parseAmount('Rp 2.000.000')).toBe('2000000.00');
  });

  it('rejects negatives and garbage', () => {
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe('splitKeywords', () => {
  it('splits, lowercases and deduplicates nothing beyond the cap', () => {
    expect(splitKeywords('Halte; Bus | Terminal')).toEqual(['halte', 'bus', 'terminal']);
  });

  it('drops empty and over long tokens', () => {
    const long = 'a'.repeat(61);
    expect(splitKeywords(` halte ;; ${long}`)).toEqual(['halte']);
  });

  it('caps the keyword count at twelve', () => {
    const raw = Array.from({ length: 20 }, (_value, index) => `k${index}`).join(';');
    expect(splitKeywords(raw)).toHaveLength(12);
  });

  it('returns an empty list for null', () => {
    expect(splitKeywords(null)).toEqual([]);
  });
});
