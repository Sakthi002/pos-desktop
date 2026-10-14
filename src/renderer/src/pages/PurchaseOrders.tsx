import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Search, Printer, Eye, PackageCheck } from 'lucide-react';
import { call } from '../lib/ipc';
import { PurchaseOrderEntry } from '../components/PurchaseOrderEntry';
import { PurchaseOrderDetail } from '../components/PurchaseOrderDetail';
import { PurchaseOrderPreview } from '../components/PurchaseOrderPreview';
import { formatPaise } from '@shared/money';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderQuery,
  type PurchaseOrderSummary,
} from '@shared/purchase-orders';

type Status = PurchaseOrderQuery['status'];

const TABS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_PILL: Record<string, string> = {
  open: 'pill ok',
  overdue: 'pill warn',
  received: 'pill info',
  cancelled: 'pill danger',
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * What has been ordered, and what became of it.
 *
 * The buying side of the quotations screen: a document that promises nothing
 * until the goods turn up. It becomes real when the supplier's bill is entered
 * against it, and then it says which bill it became.
 */
export function PurchaseOrders({ onReceive }: { onReceive: (orderId: string) => void }) {
  const [items, setItems] = useState<PurchaseOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [openValue, setOpenValue] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entering, setEntering] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<PurchaseOrderSummary | null>(null);

  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('purchaseOrders:list', { search, status, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
      setOpenCount(result.openCount);
      setOpenValue(result.openValuePaise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Purchase orders</h1>
          <p className="sub">
            {total} {total === 1 ? 'order' : 'orders'}
            {openCount > 0 && ` · ${openCount} open worth ${formatPaise(openValue)}`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEntering(true)}>
            <Plus size={15} /> New order
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
            placeholder="Search number or supplier"
          />
        </div>

        <div className="tabs inline">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={status === tab.id ? 'tab on' : 'tab'}
              onClick={() => {
                setStatus(tab.id);
                setPage(1);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty">
          <FileText size={16} /> Nothing ordered yet.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th className="num">Items</th>
                  <th>Wanted by</th>
                  <th className="num">Value</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.orderNumber}</strong>
                      <span className={STATUS_PILL[order.status] ?? 'pill'}>
                        {PURCHASE_ORDER_STATUS_LABELS[order.status]}
                      </span>
                      {order.receivedPurchaseNumber && (
                        <span className="sub-cell">{order.receivedPurchaseNumber}</span>
                      )}
                    </td>
                    <td>{formatDate(order.orderDate)}</td>
                    <td>{order.supplierName}</td>
                    <td className="num">{order.items}</td>
                    <td>{formatDate(order.expectedOn)}</td>
                    <td className="num">{formatPaise(order.totalPaise)}</td>
                    <td className="actions">
                      <button
                        className="icon-btn view"
                        title="Open"
                        onClick={() => setViewing(order.id)}
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        className="icon-btn print"
                        title="Print"
                        onClick={() => setPreviewing(order)}
                      >
                        <Printer size={15} />
                      </button>
                      {(order.status === 'open' || order.status === 'overdue') && (
                        <button
                          className="icon-btn"
                          title="The goods have arrived"
                          onClick={() => onReceive(order.id)}
                        >
                          <PackageCheck size={15} />
                        </button>
                      )}
                    </td>
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

      {entering && (
        <PurchaseOrderEntry
          onClose={() => setEntering(false)}
          onSaved={(order) => {
            setEntering(false);
            setViewing(order.id);
            void load();
          }}
        />
      )}

      {previewing && (
        <PurchaseOrderPreview
          orderId={previewing.id}
          orderNumber={previewing.orderNumber}
          onClose={() => setPreviewing(null)}
        />
      )}

      {viewing && (
        <PurchaseOrderDetail
          orderId={viewing}
          onClose={() => {
            setViewing(null);
            void load();
          }}
          onReceive={(id) => {
            setViewing(null);
            onReceive(id);
          }}
        />
      )}
    </div>
  );
}
