import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Search, Printer, Eye, ShoppingCart } from 'lucide-react';
import { call } from '../lib/ipc';
import { QuotationEntry } from '../components/QuotationEntry';
import { QuotationDetail } from '../components/QuotationDetail';
import { formatPaise } from '@shared/money';
import {
  QUOTATION_STATUS_LABELS,
  type QuotationQuery,
  type QuotationSummary,
} from '@shared/quotations';

type Status = QuotationQuery['status'];

const TABS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'expired', label: 'Expired' },
  { id: 'converted', label: 'Billed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_PILL: Record<string, string> = {
  open: 'pill ok',
  expired: 'pill warn',
  converted: 'pill',
  cancelled: 'pill danger',
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * Prices given, and what became of them.
 *
 * A quotation is the one document here that promises nothing: no stock moves,
 * no money is taken, nothing reaches the books. It becomes real only when it
 * is billed, and then it says which invoice it became.
 */
export function Quotations({ onBill }: { onBill: (quotationId: string) => void }) {
  const [items, setItems] = useState<QuotationSummary[]>([]);
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

  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('quotations:list', { search, status, page, pageSize });
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

  async function print(id: string) {
    try {
      await call('quotations:print', { id, printerName: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Quotations</h1>
          <p className="sub">
            {total} {total === 1 ? 'quotation' : 'quotations'}
            {openCount > 0 && ` · ${openCount} open worth ${formatPaise(openValue)}`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEntering(true)}>
            <Plus size={15} /> New quotation
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
            placeholder="Search number or customer"
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
        <div className="empty-state">
          <FileText size={34} />
          <h2>No quotations yet</h2>
          <p>
            Quote a price before you sell: nothing moves until the customer says yes, and then it
            becomes a bill in one tap.
          </p>
          <button className="btn-primary" onClick={() => setEntering(true)}>
            <Plus size={15} /> New quotation
          </button>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th className="num">Items</th>
                  <th>Holds until</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((q) => (
                  <tr
                    key={q.id}
                    className={
                      q.status === 'cancelled' || q.status === 'expired' ? 'muted-row' : ''
                    }
                  >
                    <td>
                      <strong>{q.quotationNumber}</strong>
                      <span className={STATUS_PILL[q.status] ?? 'pill'}>
                        {QUOTATION_STATUS_LABELS[q.status]}
                      </span>
                      {q.convertedInvoiceNumber && (
                        <span className="sub-cell">{q.convertedInvoiceNumber}</span>
                      )}
                    </td>
                    <td>{formatDate(q.quotationDate)}</td>
                    <td>{q.customerName ?? 'Walk-in'}</td>
                    <td className="num">{q.items}</td>
                    <td>{formatDate(q.validUntil)}</td>
                    <td className="num">{formatPaise(q.totalPaise)}</td>
                    <td className="actions">
                      <button
                        className="icon-btn view"
                        title="Open"
                        onClick={() => setViewing(q.id)}
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        className="icon-btn print"
                        title="Print"
                        onClick={() => void print(q.id)}
                      >
                        <Printer size={15} />
                      </button>
                      {q.status === 'open' && (
                        <button
                          className="icon-btn"
                          title="Bill this quotation"
                          onClick={() => onBill(q.id)}
                        >
                          <ShoppingCart size={15} />
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
        <QuotationEntry
          onClose={() => setEntering(false)}
          onSaved={(quotation) => {
            setEntering(false);
            setViewing(quotation.id);
            void load();
          }}
        />
      )}

      {viewing && (
        <QuotationDetail
          quotationId={viewing}
          onClose={() => {
            setViewing(null);
            void load();
          }}
          onBill={(id) => {
            setViewing(null);
            onBill(id);
          }}
        />
      )}
    </div>
  );
}
