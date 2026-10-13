import { describe, it, expect } from 'vitest';
import { parseCsv } from '../csv';
import { reportToCsv, type ReportTable } from '../reports';

const table: ReportTable = {
  kind: 'daily-sales',
  title: 'Daily sales',
  subtitle: '01/10/2026 to 07/10/2026',
  columns: [
    { key: 'day', label: 'Day', format: 'text' },
    { key: 'invoices', label: 'Invoices', format: 'int' },
    { key: 'total', label: 'Sales', format: 'money' },
    { key: 'share', label: 'Share', format: 'percent' },
  ],
  rows: [
    { day: '01/10/2026', invoices: 3, total: 123450, share: 1250 },
    { day: '02/10/2026', invoices: 1, total: 9900, share: 0 },
  ],
  totals: { day: 'Total', invoices: 4, total: 133350, share: 1250 },
  note: 'Voided invoices are excluded.',
  generatedAt: '2026-10-13T06:00:00.000Z',
};

describe('report CSV', () => {
  // The parser drops the blank spacer lines, so rows run: title, subtitle,
  // header, data, data, totals, note.
  const rows = parseCsv(reportToCsv(table));

  it('leads with the title and the range it covers', () => {
    expect(rows[0]).toEqual(['Daily sales']);
    expect(rows[1]).toEqual(['01/10/2026 to 07/10/2026']);
  });

  it('writes the same columns the screen shows', () => {
    expect(rows[2]).toEqual(['Day', 'Invoices', 'Sales', 'Share']);
  });

  it('writes money as plain decimal rupees a spreadsheet can sum', () => {
    // 123450 paise, not "₹1,234.50".
    expect(rows[3]).toEqual(['01/10/2026', '3', '1234.50', '12.50']);
  });

  it('carries the totals row and the note', () => {
    expect(rows[5]).toEqual(['Total', '4', '1333.50', '12.50']);
    expect(rows.at(-1)).toEqual(['Voided invoices are excluded.']);
  });

  it('survives a value containing a comma', () => {
    const csv = reportToCsv({
      ...table,
      rows: [{ day: 'Rice, Basmati', invoices: 1, total: 100, share: 0 }],
      totals: null,
      note: null,
    });
    expect(parseCsv(csv)[3]).toEqual(['Rice, Basmati', '1', '1.00', '0.00']);
  });
});
