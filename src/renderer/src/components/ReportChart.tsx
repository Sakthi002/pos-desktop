import { Bars, type Bar } from './Bars';
import { formatPaise } from '@shared/money';
import type { Hue } from '../lib/hues';
import type { ReportTable } from '@shared/reports';

/**
 * The chart above a report, for the reports a chart says something about.
 *
 * Most do not. A trial balance is read line by line, a day book is a diary,
 * and a stock list is looked up rather than compared — drawing those would be
 * decoration. These four are comparisons by nature: which day, which product,
 * which category, which way people paid.
 */
interface ChartShape {
  /** The column holding the name of each bar. */
  label: string;
  /** The column holding the figure, always money. */
  value: string;
  horizontal: boolean;
  hue: Hue;
  /** How many bars before the tail stops being worth drawing. */
  limit?: number;
}

const SHAPES: Partial<Record<ReportTable['kind'], ChartShape>> = {
  'daily-sales': { label: 'day', value: 'net', horizontal: false, hue: 'indigo' },
  'product-wise': { label: 'name', value: 'total', horizontal: true, hue: 'violet', limit: 10 },
  'category-wise': { label: 'category', value: 'total', horizontal: true, hue: 'amber' },
  'payment-methods': { label: 'method', value: 'net', horizontal: true, hue: 'teal' },
};

export function ReportChart({ table }: { table: ReportTable }) {
  const shape = SHAPES[table.kind];
  if (!shape) return null;

  const rows = shape.limit ? table.rows.slice(0, shape.limit) : table.rows;
  const bars: Bar[] = rows.map((row) => ({
    label: String(row[shape.label] ?? ''),
    value: Number(row[shape.value] ?? 0),
  }));

  // Every figure here is paise, and negatives are a bar chart's business to
  // leave alone: a day that refunded more than it took is a line to read, not
  // a shape to compare.
  if (bars.some((bar) => bar.value < 0)) return null;

  return (
    <section className="report-chart">
      <Bars
        bars={bars}
        horizontal={shape.horizontal}
        // A row each for a product, a category or a way of paying: different
        // things, so a colour each. Days keep one between them.
        multi={shape.horizontal}
        hue={shape.hue}
        format={(value) => formatPaise(value)}
        empty="Nothing to draw for this range."
      />
      {shape.limit && table.rows.length > shape.limit && (
        <p className="chart-note">
          The top {shape.limit} of {table.rows.length}; the rest are in the table below.
        </p>
      )}
    </section>
  );
}
