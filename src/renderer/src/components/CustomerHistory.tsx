import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import type { CustomerSummary } from '@shared/customer';
import type { SaleSummary } from '@shared/sale';

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** What this customer has bought, newest first. */
export function CustomerHistory({
  customer,
  onClose,
}: {
  customer: CustomerSummary;
  onClose: () => void;
}) {
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('sales:search', { customerId: customer.id, pageSize: 50 })
      .then((page) => {
        if (!cancelled) setSales(page.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  return (
    <Modal
      title={`${customer.name} — purchases`}
      onClose={onClose}
      width={640}
      footer={
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <dl className="facts">
        <dt>Invoices</dt>
        <dd>{customer.invoices}</dd>
        <dt>Spent</dt>
        <dd>{formatPaise(customer.totalPaise)}</dd>
        {customer.phone && (
          <>
            <dt>Phone</dt>
            <dd>{customer.phone}</dd>
          </>
        )}
        {customer.gstin && (
          <>
            <dt>GSTIN</dt>
            <dd className="mono">{customer.gstin}</dd>
          </>
        )}
      </dl>

      {!sales ? (
        <p className="empty">Loading…</p>
      ) : sales.length === 0 ? (
        <p className="empty">No purchases yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th className="num">Items</th>
                <th>Payment</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className={sale.status === 'voided' ? 'muted-row' : ''}>
                  <td>
                    <strong className="mono">{sale.invoiceNumber}</strong>
                    {sale.status === 'voided' && <span className="pill danger">Voided</span>}
                  </td>
                  <td>{formatDateTime(sale.invoiceDate)}</td>
                  <td className="num">{sale.itemCount}</td>
                  <td>{sale.paymentMethods.map((m) => m.toUpperCase()).join(' + ') || '—'}</td>
                  <td className="num">
                    {formatPaise(sale.totalPaise)}
                    {sale.returnedPaise > 0 && (
                      <span className="sub-cell">−{formatPaise(sale.returnedPaise)} returned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
