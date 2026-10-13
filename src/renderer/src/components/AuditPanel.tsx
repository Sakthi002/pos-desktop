import { useCallback, useEffect, useState } from 'react';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import type { AuditEntryView } from '@shared/ipc-contract';

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LABELS: Record<string, string> = {
  'sale.void': 'Sale voided',
  'sales_return.create': 'Return taken',
  'product.stock_adjusted': 'Stock adjusted',
  'settings.update': 'Settings changed',
  'backup.create': 'Backup taken',
  'backup.restore': 'Data restored',
};

const label = (entry: AuditEntryView): string =>
  LABELS[`${entry.entityType}.${entry.action}`] ?? `${entry.entityType} ${entry.action}`;

/** A path is only useful here as a file name; the full one is in the tooltip. */
const shorten = (value: string): string => {
  if (value.length < 40 || !/[\\/]/.test(value)) return value;
  const parts = value.split(/[\\/]/);
  return `…/${parts[parts.length - 1]}`;
};

const readable = (key: string): string =>
  key
    .replace(/Paise$/, '')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase();

/** Quantities are stored in thousandths; a reader wants units. */
const QUANTITY_KEYS = new Set(['delta', 'before', 'after', 'quantityMilli']);

const valueOf = (key: string, value: unknown, unitCode?: string): string => {
  if (key.endsWith('Paise') && typeof value === 'number') return formatPaise(value);
  if (unitCode && QUANTITY_KEYS.has(key) && typeof value === 'number') {
    return `${formatQuantity(value, precisionFor(unitCode))} ${unitCode}`;
  }
  if (typeof value === 'string') return shorten(value);
  return String(value);
};

/**
 * Details as a sentence a shopkeeper can read. Money keys are paise, nested
 * objects — a settings change lists what changed — are flattened one level.
 */
const describe = (details: Record<string, unknown> | null): string[] => {
  if (!details) return [];

  const unitCode = typeof details['unitCode'] === 'string' ? details['unitCode'] : undefined;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'unitCode') continue; // carried for formatting, not for reading

    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        parts.push(`${inner}: ${valueOf(inner, innerValue, unitCode)}`);
      }
      continue;
    }
    parts.push(`${readable(key)}: ${valueOf(key, value, unitCode)}`);
  }
  return parts;
};

/**
 * The audit trail, newest first.
 *
 * Read-only by construction: the database refuses updates and deletes on these
 * rows, so what is shown here is what happened.
 */
export function AuditPanel() {
  const [items, setItems] = useState<AuditEntryView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    try {
      const result = await call('audit:list', { page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <p className="field-hint" style={{ marginBottom: 14 }}>
        Voids, returns, stock adjustments, settings changes and restores. Entries can be added but
        never changed or removed, including by this app.
      </p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="empty">Nothing recorded yet.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Details</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <strong>{label(entry)}</strong>
                    </td>
                    <td className="audit-details" title={JSON.stringify(entry.details ?? {})}>
                      {describe(entry.details).join(' · ')}
                    </td>
                    <td>{entry.operatorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="pager">
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
