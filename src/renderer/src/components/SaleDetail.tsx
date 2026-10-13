import { useEffect, useState } from 'react';
import { Printer, Ban, Ghost, Undo2 } from 'lucide-react';
import { Modal } from './Modal';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import type { SaleReceipt } from '@shared/sale';
import type { ReturnableSale } from '@shared/returns';

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The invoice exactly as it was issued. Every figure here is read back from the
 * sale, not recalculated from today's catalogue — a price change tomorrow must
 * not rewrite what the customer was charged.
 */
export function SaleDetail({
  saleId,
  onClose,
  onPrint,
  onVoid,
  onReturn,
}: {
  saleId: string;
  onClose: () => void;
  onPrint: (saleId: string) => void;
  onVoid: (receipt: SaleReceipt) => void;
  onReturn: (saleId: string) => void;
}) {
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [returnable, setReturnable] = useState<ReturnableSale | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Loaded from main; a response for a sale the operator has moved on from
    // is dropped rather than rendered over the new one.
    let cancelled = false;
    void Promise.all([
      call('sales:getReceipt', { id: saleId }),
      call('returns:getSale', { saleId }),
    ])
      .then(([data, returns]) => {
        if (cancelled) return;
        setReceipt(data);
        setReturnable(returns);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const bill = receipt?.bill;
  const voided = receipt?.status === 'voided';
  // A credit note has already reversed part of this invoice, so voiding it
  // would return the same goods twice. Returns are the only route left.
  const hasReturns = (returnable?.priorReturns.length ?? 0) > 0;

  return (
    <Modal
      title={receipt ? `Invoice ${receipt.invoiceNumber}` : 'Invoice'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {receipt && !voided && returnable?.canReturn && (
            <button className="btn-secondary" onClick={() => onReturn(receipt.id)}>
              <Undo2 size={15} /> Return items
            </button>
          )}
          {receipt && !voided && !hasReturns && (
            <button className="btn-danger" onClick={() => onVoid(receipt)}>
              <Ban size={15} /> Void
            </button>
          )}
          {receipt && (
            <button className="btn-primary" onClick={() => onPrint(receipt.id)}>
              <Printer size={15} /> Print / PDF
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

      {!receipt || !bill ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          {voided && (
            <p className="void-banner" role="status">
              <Ghost size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              <strong>Voided</strong>
              {receipt.voidedAt ? ` on ${formatDateTime(receipt.voidedAt)}` : ''}
              {receipt.voidReason ? ` — ${receipt.voidReason}` : ''}
            </p>
          )}

          {hasReturns && (
            <p className="return-note" role="status">
              <Undo2 size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Returned under{' '}
              {returnable?.priorReturns
                .map((r) => `${r.returnNumber} (${formatPaise(r.totalPaise)})`)
                .join(', ')}
            </p>
          )}

          <dl className="facts">
            <dt>Date</dt>
            <dd>{formatDateTime(receipt.invoiceDate)}</dd>
            <dt>Customer</dt>
            <dd>{receipt.customerName ?? 'Walk-in'}</dd>
            {receipt.customerGstin && (
              <>
                <dt>GSTIN</dt>
                <dd className="mono">{receipt.customerGstin}</dd>
              </>
            )}
            <dt>Financial year</dt>
            <dd>{receipt.financialYear}</dd>
          </dl>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Discount</th>
                  <th className="num">Tax</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((line) => (
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
                    <td className="num">
                      {line.totalDiscountPaise ? formatPaise(line.totalDiscountPaise) : '—'}
                    </td>
                    <td className="num">
                      {formatPaise(line.taxPaise)}
                      <span className="sub-cell">{(line.taxRateBp / 100).toFixed(0)}%</span>
                    </td>
                    <td className="num">{formatPaise(line.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="detail-foot">
            <div className="detail-payments">
              <h3>Payments</h3>
              <ul>
                {receipt.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.method.toUpperCase()}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    <strong>{formatPaise(p.amountPaise)}</strong>
                  </li>
                ))}
                {receipt.changePaise > 0 && (
                  <li className="muted">
                    <span>Change given</span>
                    <strong>{formatPaise(receipt.changePaise)}</strong>
                  </li>
                )}
              </ul>
              {receipt.notes && <p className="field-hint">{receipt.notes}</p>}
            </div>

            <div className="totals">
              <div className="t-row">
                <span>Gross</span>
                <span>{formatPaise(bill.grossPaise)}</span>
              </div>
              {bill.itemDiscountPaise + bill.cartDiscountPaise > 0 && (
                <div className="t-row">
                  <span>Discount</span>
                  <span>−{formatPaise(bill.itemDiscountPaise + bill.cartDiscountPaise)}</span>
                </div>
              )}
              <div className="t-row">
                <span>Taxable</span>
                <span>{formatPaise(bill.taxablePaise)}</span>
              </div>
              {bill.isInterstate ? (
                <div className="t-row small">
                  <span>IGST</span>
                  <span>{formatPaise(bill.igstPaise)}</span>
                </div>
              ) : (
                <>
                  <div className="t-row small">
                    <span>CGST</span>
                    <span>{formatPaise(bill.cgstPaise)}</span>
                  </div>
                  <div className="t-row small">
                    <span>SGST</span>
                    <span>{formatPaise(bill.sgstPaise)}</span>
                  </div>
                </>
              )}
              {bill.roundOffPaise !== 0 && (
                <div className="t-row small">
                  <span>Round off</span>
                  <span>
                    {bill.roundOffPaise > 0 ? '+' : '−'}
                    {formatPaise(Math.abs(bill.roundOffPaise))}
                  </span>
                </div>
              )}
              <div className="t-row grand">
                <span>Total</span>
                <span>{formatPaise(bill.totalPaise)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
