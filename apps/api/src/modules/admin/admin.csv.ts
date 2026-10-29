export interface CsvTable {
  header: string[];
  rows: string[][];
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/u, '')
    .replace(/[\s-]+/gu, '_');
}

export function parseCsv(raw: string): CsvTable {
  const text = raw.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let index = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };

  const pushRow = (): void => {
    pushField();
    const complete = row;
    row = [];
    if (complete.length === 1 && complete[0] === '') {
      return;
    }
    rows.push(complete);
  };

  while (index < text.length) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      pushField();
      index += 1;
      continue;
    }
    if (character === '\n') {
      pushRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }

  if (quoted) {
    throw new Error('CSV memiliki tanda kutip yang tidak ditutup.');
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  const first = rows[0];
  if (first === undefined) {
    return { header: [], rows: [] };
  }
  return {
    header: first.map(normalizeHeader),
    rows: rows.slice(1),
  };
}

export function columnIndex(header: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const found = header.indexOf(name);
    if (found >= 0) {
      return found;
    }
  }
  return -1;
}

export function cell(row: readonly string[], index: number): string | null {
  if (index < 0) {
    return null;
  }
  const value = row[index];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseAmount(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const cleaned = raw.replace(/[^0-9.,-]/gu, '');
  if (cleaned.length === 0) {
    return null;
  }
  const dots = cleaned.split('.').length - 1;
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./gu, '').replace(',', '.');
  } else if (dots > 1) {
    normalized = cleaned.replace(/\./gu, '');
  } else {
    normalized = cleaned;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value.toFixed(2);
}

export function splitKeywords(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  return raw
    .split(/[;|]/u)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0 && value.length <= 60)
    .slice(0, 12);
}
