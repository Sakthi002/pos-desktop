import { useCallback, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { call } from '../lib/ipc';
import { formatQuantity, precisionFor } from '@shared/quantity';
import type { MovementPage, MovementType } from '@shared/inventory';

const LABELS: Record<MovementType, string> = {
  opening: 'Opening stock',
  sale: 'Sale',
  sale_return: 'Return',
  adjustment: 'Adjustment',
  purchase: 'Purchase',
  damage: 'Damage',
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Every movement for one product, newest first, with the balance after each.
 * The ledger is the stock: this screen is how a shopkeeper checks why the
 * number is what it is.
 */
export function MovementHistory({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MovementPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    try {
      setData(await call('inventory:movements', { productId, page, pageSize }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [productId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  const precision = data ? precisionFor(data.unitCode) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <Modal
      title={data ? `${data.productName} — stock history` : 'Stock history'}
      onClose={onClose}
      width={720}
      footer={
        <>
          {pages > 1 && (
            <div className="pager" style={{ marginRight: 'auto', padding: 0 }}>
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
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty">No movements yet.</p>
      ) : (
        <>
          <p className="current-stock">
            In stock now: <strong>{formatQuantity(data.stockMilli, precision)}</strong>{' '}
            {data.unitCode}
          </p>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Movement</th>
                  <th>Document</th>
                  <th className="num">Change</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>
                      {LABELS[m.movementType]}
                      {m.reason && m.reason !== LABELS[m.movementType] && (
                        <span className="sub-cell">{m.reason}</span>
                      )}
                    </td>
                    <td className="mono">{m.documentNumber ?? '—'}</td>
                    <td className={m.quantityMilli < 0 ? 'num stock low' : 'num'}>
                      {m.quantityMilli > 0 ? '+' : '−'}
                      {formatQuantity(Math.abs(m.quantityMilli), precision)}
                    </td>
                    <td className="num">{formatQuantity(m.balanceMilli, precision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
