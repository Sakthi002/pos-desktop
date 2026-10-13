/**
 * Reports.
 *
 * Every report comes back as the same shape: columns, rows, and an optional
 * totals row. One table component renders any of them and one function turns
 * any of them into CSV, so a new report is a query in main rather than a new
 * screen — and the CSV can never disagree with what is on screen, because both
 * read the same rows.
 *
 * Definitions that apply to all of them live in `docs/reports.md`. The short
 * version: only completed sales count, voided ones never do, returns are
 * reported separately and netted where it matters, and every money figure is
 * read from the stored invoice rather than recalculated.
 */
import { z } from 'zod';
import { paiseToDecimalString } from './money';
import { toCsv } from './csv';

export const REPORT_KINDS = [
  'sales-summary',
  'daily-sales',
  'product-wise',
  'category-wise',
  'payment-methods',
  'tax-summary',
  'discount-summary',
  'returns',
  'purchases',
  'purchase-returns',
  'supplier-outstanding',
  'trial-balance',
  'cash-book',
  'day-book',
  'stock-on-hand',
  'stock-movement',
  'low-stock',
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

/** Reports that describe stock as it is now, so a date range does not apply. */
export const SNAPSHOT_REPORTS: ReportKind[] = [
  'stock-on-hand',
  'low-stock',
  'supplier-outstanding',
];

export const reportQuerySchema = z.object({
  kind: z.enum(REPORT_KINDS),
  fromIso: z.iso.datetime().nullable().optional(),
  toIso: z.iso.datetime().nullable().optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** `money` is integer paise and is formatted at the display edge, never before. */
export type ColumnFormat = 'text' | 'money' | 'int' | 'percent' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  format: ColumnFormat;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportTable {
  kind: ReportKind;
  title: string;
  /** Describes the range or the moment the figures belong to. */
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Column totals, where a total means something. */
  totals: ReportRow | null;
  /** Caveats the reader needs — an estimate, an exclusion, a definition. */
  note: string | null;
  generatedAt: string;
}

export const REPORT_LABELS: Record<ReportKind, string> = {
  'sales-summary': 'Sales summary',
  'daily-sales': 'Daily sales',
  'product-wise': 'Product-wise sales',
  'category-wise': 'Category-wise sales',
  'payment-methods': 'Payment methods',
  'tax-summary': 'Tax summary',
  'discount-summary': 'Discounts',
  returns: 'Returns',
  purchases: 'Purchases',
  'purchase-returns': 'Purchase returns',
  'supplier-outstanding': 'Supplier outstanding',
  'trial-balance': 'Trial balance',
  'cash-book': 'Cash book',
  'day-book': 'Day book',
  'stock-on-hand': 'Stock on hand',
  'stock-movement': 'Stock movement',
  'low-stock': 'Low stock',
};

const csvCell = (value: ReportCell, format: ColumnFormat): string | number => {
  if (value === null) return '';
  if (format === 'money' && typeof value === 'number') return paiseToDecimalString(value);
  if (format === 'percent' && typeof value === 'number') return (value / 100).toFixed(2);
  return value;
};

/**
 * CSV of exactly what the screen shows. Money goes out as plain decimal rupees
 * — a spreadsheet can sum those, but not "₹1,234.50".
 */
export function reportToCsv(table: ReportTable): string {
  const rows: (string | number | null)[][] = [
    [table.title],
    [table.subtitle],
    [],
    table.columns.map((c) => c.label),
    ...table.rows.map((row) => table.columns.map((c) => csvCell(row[c.key] ?? null, c.format))),
  ];

  if (table.totals) {
    rows.push(table.columns.map((c) => csvCell(table.totals?.[c.key] ?? null, c.format)));
  }
  if (table.note) {
    rows.push([], [table.note]);
  }

  return toCsv(rows);
}
