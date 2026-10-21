import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, PackagePlus, Eye, CheckCircle2, X } from 'lucide-react';
import { call } from '../lib/ipc';
import { PurchaseEntry } from '../components/PurchaseEntry';
import { Pager } from '../components/Pager';
import { PAGE_SIZES } from '../lib/paging';
import { PurchaseDetail } from '../components/PurchaseDetail';
import { formatPaise } from '@shared/money';
import type { PurchaseQuery, PurchaseSummary, Supplier } from '@shared/purchasing';

type Status = PurchaseQuery['status'];

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function Purchases({
  receivingOrderId,
  onOrderReceived,
}: {
  /** An order whose goods have arrived: the bill opens on it. */
  receivingOrderId?: string | null;
  onOrderReceived?: () => void;
} = {}) {
  const [items, setItems] = useState<PurchaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [purchasedPaise, setPurchasedPaise] = useState(0);
  const [outstandingPaise, setOutstandingPaise] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [entering, setEntering] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('purchases:search', {
        search,
        supplierId: supplierId || null,
        status,
        unpaidOnly,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setPurchasedPaise(result.purchasedPaise);
      setOutstandingPaise(result.outstandingPaise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, supplierId, status, unpaidOnly, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  useEffect(() => {
    void call('suppliers:list', { status: 'active', pageSize: 200 })
      .then((p) => setSuppliers(p.items))
      .catch(() => undefined);
  }, []);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Purchases</h1>
          <p className="sub">
            {total} {total === 1 ? 'bill' : 'bills'} · {formatPaise(purchasedPaise)} bought
            {outstandingPaise > 0 && ` · ${formatPaise(outstandingPaise)} still owed`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEntering(true)}>
            <Plus size={16} /> New purchase
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search our number, their bill number or supplier"
          />
        </div>

        <select
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="tabs inline">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              className={status === t.id ? 'tab on' : 'tab'}
              onClick={() => {
                setStatus(t.id);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => {
              setUnpaidOnly(e.target.checked);
              setPage(1);
            }}
          />
          <span>Unpaid only</span>
        </label>
      </div>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}

      {notice && (
        <p className="preview-ok" role="status">
          <CheckCircle2 size={14} /> {notice}
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </p>
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <PackagePlus size={34} />
          <h2>{search || supplierId ? 'No purchases match' : 'No purchases yet'}</h2>
          <p>
            {search || supplierId
              ? 'Try a different search or supplier.'
              : 'Record what you buy and stock goes up, cost prices follow, and you can see what you owe.'}
          </p>
          {!search && !supplierId && (
            <div className="page-actions">
              <button className="btn-primary" onClick={() => setEntering(true)}>
                <Plus size={16} /> New purchase
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Their bill</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th className="num">Items</th>
                  <th className="num">Total</th>
                  <th className="num">Owed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    className={p.status === 'cancelled' ? 'muted-row' : ''}
                    onDoubleClick={() => setDetailId(p.id)}
                  >
                    <td>
                      <strong className="mono">{p.purchaseNumber}</strong>
                      {p.status === 'cancelled' && <span className="pill danger">Cancelled</span>}
                    </td>
                    <td className="mono">{p.supplierBillNo ?? '—'}</td>
                    <td>{formatDate(p.purchaseDate)}</td>
                    <td>{p.supplierName ?? '—'}</td>
                    <td className="num">{p.itemCount}</td>
                    <td className="num">
                      {formatPaise(p.totalPaise)}
                      {p.returnedPaise > 0 && (
                        <span className="sub-cell">−{formatPaise(p.returnedPaise)} returned</span>
                      )}
                    </td>
                    <td className="num">
                      {p.outstandingPaise > 0 ? (
                        <strong className="stock low">{formatPaise(p.outstandingPaise)}</strong>
                      ) : (
                        <span className="sub-cell">Settled</span>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="icon-btn view"
                        title="Open"
                        onClick={() => setDetailId(p.id)}
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}

      {(entering || receivingOrderId) && (
        <PurchaseEntry
          purchaseOrderId={receivingOrderId ?? null}
          onClose={() => {
            setEntering(false);
            onOrderReceived?.();
          }}
          onSaved={(purchase) => {
            setEntering(false);
            onOrderReceived?.();
            setNotice(
              `${purchase.purchaseNumber} recorded — ${formatPaise(purchase.totalPaise)} from ${purchase.supplierName ?? 'the supplier'}, stock updated.`,
            );
            void load();
          }}
        />
      )}

      {detailId && (
        <PurchaseDetail
          purchaseId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
