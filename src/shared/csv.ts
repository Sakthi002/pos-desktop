/**
 * Minimal RFC 4180 CSV reader and writer.
 *
 * Written rather than pulled in, because the need is narrow and a shop's
 * product file routinely contains commas inside names ("Rice, Basmati 5kg")
 * and quotes, which a naive split would corrupt.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const char = input[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Trailing field, unless the file ended on a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const needsQuoting = (value: string): boolean =>
  value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r');

export const escapeCsvField = (value: string): string =>
  needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => escapeCsvField(cell === null || cell === undefined ? '' : String(cell)))
        .join(','),
    )
    .join('\n');
}
