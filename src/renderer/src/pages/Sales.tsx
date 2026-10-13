import { useCallback, useEffect, useState } from 'react';
import { Search, Receipt, Printer, Ban, Eye, CheckCircle2, X } from 'lucide-react';
import { call } from '../lib/ipc';
import { SaleDetail } from '../components/SaleDetail';
import { ReturnDialog } from '../components/ReturnDialog';
import { VoidSaleDialog } from '../components/VoidSaleDialog';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { formatPaise } from '@shared/money';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleQuery,
  type SaleSummary,
} from '@shared/sale';
import type { AppSettings } from '@shared/settings';

type StatusFilter = SaleQuery['status'];

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'voided', label: 'Voided' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local time — what a date input expects. */
const dateInputValue = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

/**
 * Local calendar day to instant. The shop thinks in its own days; the database
 * stores UTC timestamps, so the boundary is converted here rather than compared
 * as text, which would shift every sale after 5:30 am IST into the wrong day.
 */
const startInstant = (value: string): string | null => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
};

const endInstant = (value: string): string | null => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Sales({ settings }: { settings: AppSettings }) {
  const [items, setItems] = useState<SaleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [completedTotalPaise, setCompletedTotalPaise] = useState(0);
  const [voidedCount, setVoidedCount] = useState(0);
  const [returnedTotalPaise, setReturnedTotalPaise] = useState(0);

  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<SaleSummary | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('sales:search', {
        search,
        fromIso: from ? startInstant(from) : null,
        toIso: to ? endInstant(to) : null,
        paymentMethod: method || null,
        status,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setCompletedCount(result.completedCount);
      setCompletedTotalPaise(result.completedTotalPaise);
      setVoidedCount(result.voidedCount);
      setReturnedTotalPaise(result.returnedTotalPaise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, from, to, method, status, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  function applyPreset(days: number | null) {
    if (days === null) {
      setFrom('');
      setTo('');
    } else {
      setFrom(dateInputValue(daysAgo(days)));
      setTo(dateInputValue(new Date()));
    }
    setPage(1);
  }

  const today = dateInputValue(new Date());
  const presets: { label: string; days: number | null }[] = [
    { label: 'Today', days: 0 },
    { label: '7 days', days: 6 },
    { label: '30 days', days: 29 },
    { label: 'All', days: null },
  ];
  const activePreset = (days: number | null): boolean =>
    days === null
      ? from === '' && to === ''
      : from === dateInputValue(daysAgo(days)) && to === today;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(search || from || to || method || status !== 'all');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Sales</h1>
          <p className="sub">
            {completedCount} {completedCount === 1 ? 'invoice' : 'invoices'} ·{' '}
            {formatPaise(completedTotalPaise)}
            {voidedCount > 0 && ` · ${voidedCount} voided`}
            {returnedTotalPaise > 0 && ` · ${formatPaise(returnedTotalPaise)} returned`}
          </p>
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
            placeholder="Search invoice number, customer or phone"
          />
        </div>

        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as PaymentMethod | '');
            setPage(1);
          }}
        >
          <option value="">Any payment</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m.toUpperCase()}
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
      </div>

      <div className="toolbar date-bar">
        <div className="chips">
          {presets.map((p) => (
            <button
              key={p.label}
              className={activePreset(p.days) ? 'chip on' : 'chip'}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="date-field">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="date-field">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
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
          <Receipt size={34} />
          <h2>{filtered ? 'No sales match' : 'No sales yet'}</h2>
          <p>
            {filtered
              ? 'Try a wider date range or a different search.'
              : 'Completed bills appear here, with reprint and void.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th className="num">Items</th>
                  <th>Payment</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((sale) => (
                  <tr
                    key={sale.id}
                    className={sale.status === 'voided' ? 'muted-row' : ''}
                    onDoubleClick={() => setDetailId(sale.id)}
                  >
                    <td>
                      <strong className="mono">{sale.invoiceNumber}</strong>
                      {sale.status === 'voided' && <span className="pill danger">Voided</span>}
                    </td>
                    <td>{formatDateTime(sale.invoiceDate)}</td>
                    <td>
                      {sale.customerName ?? 'Walk-in'}
                      {sale.customerPhone && <span className="sub-cell">{sale.customerPhone}</span>}
                    </td>
                    <td className="num">{sale.itemCount}</td>
                    <td>
                      {sale.paymentMethods.length > 0
                        ? sale.paymentMethods.map((m) => m.toUpperCase()).join(' + ')
                        : '—'}
                    </td>
                    <td className="num">
                      {formatPaise(sale.totalPaise)}
                      {sale.returnedPaise > 0 && (
                        <span className="sub-cell">
                          −{formatPaise(sale.returnedPaise)} returned
                        </span>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="icon-btn"
                        title="View invoice"
                        onClick={() => setDetailId(sale.id)}
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Reprint"
                        onClick={() => setPrinting(sale.id)}
                      >
                        <Printer size={15} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title={sale.status === 'voided' ? 'Already voided' : 'Void sale'}
                        disabled={sale.status === 'voided'}
                        onClick={() => setVoiding(sale)}
                      >
                        <Ban size={15} />
                      </button>
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

      {detailId && (
        <SaleDetail
          saleId={detailId}
          onClose={() => setDetailId(null)}
          onPrint={(id) => setPrinting(id)}
          onReturn={(id) => {
            setDetailId(null);
            setReturning(id);
          }}
          onVoid={(receipt) => {
            setDetailId(null);
            setVoiding({
              id: receipt.id,
              invoiceNumber: receipt.invoiceNumber,
              invoiceDate: receipt.invoiceDate,
              customerName: receipt.customerName,
              customerPhone: null,
              itemCount: receipt.bill.lines.length,
              totalPaise: receipt.bill.totalPaise,
              returnedPaise: 0,
              status: receipt.status,
              paymentMethods: receipt.payments.map((p) => p.method),
              voidedAt: receipt.voidedAt,
              voidReason: receipt.voidReason,
            });
          }}
        />
      )}

      {printing && (
        <ReceiptPreview
          saleId={printing}
          settings={settings}
          isReprint
          onClose={() => setPrinting(null)}
        />
      )}

      {returning && (
        <ReturnDialog
          saleId={returning}
          onClose={() => setReturning(null)}
          onReturned={(credit) => {
            setReturning(null);
            setNotice(
              `Credit note ${credit.returnNumber} raised — ${formatPaise(credit.totalPaise)} refunded by ${credit.refundMethod.toUpperCase()}.`,
            );
            void load();
          }}
        />
      )}

      {voiding && (
        <VoidSaleDialog
          sale={voiding}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setVoiding(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
