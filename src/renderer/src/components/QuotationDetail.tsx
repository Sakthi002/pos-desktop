import { useEffect, useState } from 'react';
import { Printer, ShoppingCart, Ban } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { QUOTATION_STATUS_LABELS, type Quotation } from '@shared/quotations';

const formatDate = (iso: string | null): string => {
  if (!iso) return 'until withdrawn';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * One quotation, as it was given. Nothing here edits it: a price a customer
 * has seen is a thing that happened, so a mistake is cancelled with a reason
 * and quoted again.
 */
export function QuotationDetail({
  quotationId,
  onClose,
  onBill,
}: {
  quotationId: string;
  onClose: () => void;
  onBill: (quotationId: string) => void;
}) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    void call('quotations:get', { id: quotationId })
      .then((result) => {
        if (!cancelled) setQuotation(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await call('quotations:print', { id: quotationId, printerName: null });
      if (!outcome.printed && outcome.reason) setError(outcome.reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      setQuotation(await call('quotations:cancel', { id: quotationId, reason: reason.trim() }));
      setCancelling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const open = quotation?.status === 'open';

  return (
    <Modal
      title={quotation ? `Quotation ${quotation.quotationNumber}` : 'Quotation'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          {quotation && quotation.status !== 'converted' && quotation.status !== 'cancelled' && (
            <button className="btn-warn" onClick={() => setCancelling(true)} disabled={busy}>
              <Ban size={15} /> Cancel it
            </button>
          )}
          <button className="btn-info" onClick={() => void print()} disabled={busy || !quotation}>
            <Printer size={15} /> Print
          </button>
          {open && (
            <button className="btn-primary" onClick={() => onBill(quotationId)}>
              <ShoppingCart size={15} /> Bill it
            </button>
          )}
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!quotation ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="dash-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <span className="stat-label">Total quoted</span>
              <strong className="stat-value">{formatPaise(quotation.bill.totalPaise)}</strong>
              <span className="stat-note">
                {quotation.customerName ?? 'Walk-in customer'} · holds{' '}
                {formatDate(quotation.validUntil)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Status</span>
              <strong className="stat-value">{QUOTATION_STATUS_LABELS[quotation.status]}</strong>
              {quotation.convertedInvoiceNumber && (
                <span className="stat-note">Billed as {quotation.convertedInvoiceNumber}</span>
              )}
              {quotation.cancelReason && (
                <span className="stat-note">{quotation.cancelReason}</span>
              )}
            </div>
          </div>

          {cancelling && (
            <div className="panel-card" style={{ padding: 14, marginBottom: 14 }}>
              <Field label="Why is it being cancelled" htmlFor="q-cancel" required>
                <input
                  id="q-cancel"
                  value={reason}
                  placeholder="Customer bought elsewhere"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="page-actions">
                <button className="btn-secondary" onClick={() => setCancelling(false)}>
                  Keep it
                </button>
                <button
                  className="btn-danger"
                  onClick={() => void cancel()}
                  disabled={busy || reason.trim().length < 3}
                >
                  Cancel this quotation
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {quotation.bill.lines.map((line) => (
                  <tr key={line.lineNo}>
                    <td>
                      <strong>{line.name}</strong>
                      {line.sku && <span className="sub-cell">{line.sku}</span>}
                    </td>
                    <td className="num">
                      {formatQuantity(line.quantityMilli, precisionFor(line.unitCode))}{' '}
                      {line.unitCode}
                    </td>
                    <td className="num">{formatPaise(line.unitPricePaise)}</td>
                    <td className="num">{formatPaise(line.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="detail-foot">
            <div className="detail-payments">
              <h3>Not a bill</h3>
              <p className="field-hint">
                No stock has moved and no money has been taken. That happens when it is billed, and
                the sale is a new document that points back here.
              </p>
              {quotation.notes && <p className="field-hint">{quotation.notes}</p>}
            </div>

            <div className="totals">
              <div className="t-row">
                <span>Gross</span>
                <span>{formatPaise(quotation.bill.grossPaise)}</span>
              </div>
              {quotation.bill.itemDiscountPaise + quotation.bill.cartDiscountPaise > 0 && (
                <div className="t-row">
                  <span>Discount</span>
                  <span>
                    −
                    {formatPaise(
                      quotation.bill.itemDiscountPaise + quotation.bill.cartDiscountPaise,
                    )}
                  </span>
                </div>
              )}
              <div className="t-row">
                <span>{quotation.bill.taxPaise > 0 ? 'Taxable' : 'Value'}</span>
                <span>{formatPaise(quotation.bill.taxablePaise)}</span>
              </div>
              {quotation.bill.taxPaise > 0 &&
                (quotation.bill.isInterstate ? (
                  <div className="t-row small">
                    <span>IGST</span>
                    <span>{formatPaise(quotation.bill.igstPaise)}</span>
                  </div>
                ) : (
                  <>
                    <div className="t-row small">
                      <span>CGST</span>
                      <span>{formatPaise(quotation.bill.cgstPaise)}</span>
                    </div>
                    <div className="t-row small">
                      <span>SGST</span>
                      <span>{formatPaise(quotation.bill.sgstPaise)}</span>
                    </div>
                  </>
                ))}
              {quotation.bill.roundOffPaise !== 0 && (
                <div className="t-row small">
                  <span>Round off</span>
                  <span>
                    {quotation.bill.roundOffPaise > 0 ? '+' : '−'}
                    {formatPaise(Math.abs(quotation.bill.roundOffPaise))}
                  </span>
                </div>
              )}
              <div className="t-row grand">
                <span>Total quoted</span>
                <span>{formatPaise(quotation.bill.totalPaise)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
