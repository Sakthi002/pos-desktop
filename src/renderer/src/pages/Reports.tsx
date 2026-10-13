import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import {
  REPORT_KINDS,
  REPORT_LABELS,
  SNAPSHOT_REPORTS,
  reportToCsv,
  type ReportCell,
  type ReportColumn,
  type ReportKind,
  type ReportTable,
} from '@shared/reports';
import type { AppSettings } from '@shared/settings';

const pad = (n: number) => String(n).padStart(2, '0');
const dateInputValue = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

/** Local day to instant: the shop's day, converted once, here. */
const startInstant = (value: string): string | null => {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d, 0, 0, 0, 0).toISOString() : null;
};

const endInstant = (value: string): string | null => {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() : null;
};

const renderCell = (value: ReportCell, column: ReportColumn): string => {
  if (value === '') return '';
  if (value === null || value === undefined) return '—';
  if (column.format === 'money' && typeof value === 'number') return formatPaise(value);
  if (column.format === 'percent' && typeof value === 'number')
    return `${(value / 100).toFixed(2)}%`;
  return String(value);
};

const isNumeric = (column: ReportColumn): boolean =>
  column.format === 'money' || column.format === 'int' || column.format === 'percent';

/**
 * One screen for every report. Main decides the columns, the rows and the
 * caveats; this renders them and hands the same rows to the CSV writer, so an
 * exported file always matches what was on screen.
 */
export function Reports({ settings }: { settings: AppSettings }) {
  // A shop that charges no GST has no tax position to report on.
  const kinds = REPORT_KINDS.filter((k) => settings.tax.registered || k !== 'tax-summary');

  const [kind, setKind] = useState<ReportKind>('sales-summary');
  const [from, setFrom] = useState(dateInputValue(daysAgo(29)));
  const [to, setTo] = useState(dateInputValue(new Date()));
  const [table, setTable] = useState<ReportTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const needsRange = !SNAPSHOT_REPORTS.includes(kind);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      setTable(
        await call('reports:run', {
          kind,
          fromIso: needsRange ? startInstant(from) : null,
          toIso: needsRange ? endInstant(to) : null,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTable(null);
    } finally {
      setLoading(false);
    }
  }, [kind, from, to, needsRange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function exportCsv() {
    if (!table) return;
    try {
      const result = await call('dialog:saveCsv', {
        suggestedName: `${table.kind}-${dateInputValue(new Date())}.csv`,
        content: reportToCsv(table),
      });
      if (result.saved) setSaved('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const presets: { label: string; days: number }[] = [
    { label: 'Today', days: 0 },
    { label: '7 days', days: 6 },
    { label: '30 days', days: 29 },
    { label: '90 days', days: 89 },
  ];
  const today = dateInputValue(new Date());
  const activePreset = (days: number) => from === dateInputValue(daysAgo(days)) && to === today;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">{table ? table.subtitle : 'Choose a report'}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn-secondary"
            onClick={() => void exportCsv()}
            disabled={!table || table.rows.length === 0}
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </header>

      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {REPORT_LABELS[k]}
            </option>
          ))}
        </select>

        {needsRange && (
          <>
            <div className="chips">
              {presets.map((p) => (
                <button
                  key={p.label}
                  className={activePreset(p.days) ? 'chip on' : 'chip'}
                  onClick={() => {
                    setFrom(dateInputValue(daysAgo(p.days)));
                    setTo(today);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="date-field">
              From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="date-field">
              To
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}
      {saved && (
        <p className="preview-ok" role="status">
          {saved}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : !table || table.rows.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={34} />
          <h2>Nothing to report</h2>
          <p>No activity in this range. Try a wider one.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data report">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} className={isNumeric(c) ? 'num' : ''}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <td key={c.key} className={isNumeric(c) ? 'num' : ''}>
                        {renderCell(row[c.key] ?? null, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.totals && (
                <tfoot>
                  <tr>
                    {table.columns.map((c) => (
                      <td key={c.key} className={isNumeric(c) ? 'num' : ''}>
                        {renderCell(table.totals?.[c.key] ?? null, c)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {table.note && <p className="report-note">{table.note}</p>}
        </>
      )}
    </div>
  );
}
