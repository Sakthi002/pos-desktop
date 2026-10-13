import { useEffect, useState } from 'react';
import { Undo2, Ban, Wallet, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import {
  PURCHASE_SETTLEMENTS,
  SUPPLIER_PAYMENT_METHODS,
  type PurchaseReceipt,
  type PurchaseSettlement,
  type SupplierPaymentMethod,
} from '@shared/purchasing';

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Mode = 'view' | 'return' | 'pay' | 'cancel';

/**
 * One supplier bill: what arrived, what it cost, what has been paid, and the
 * three things that can still happen to it — a payment, a return, or a
 * cancellation. All of them read back from the stored document.
 */
export function PurchaseDetail({
  purchaseId,
  onClose,
  onChanged,
}: {
  purchaseId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [purchase, setPurchase] = useState<PurchaseReceipt | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<PurchaseSettlement>('debit_note');
  const [payMethod, setPayMethod] = useState<SupplierPaymentMethod>('cash');
  const [payAmount, setPayAmount] = useState('');
  const [reference, setReference] = useState('');

  const load = () =>
    call('purchases:get', { id: purchaseId })
      .then((data) => {
        setPurchase(data);
        setPayAmount((data.outstandingPaise / 100).toFixed(2));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    let cancelled = false;
    void call('purchases:get', { id: purchaseId })
      .then((data) => {
        if (cancelled) return;
        setPurchase(data);
        setPayAmount((data.outstandingPaise / 100).toFixed(2));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseId]);

  async function submitReturn() {
    if (!purchase) return;
    const lines = purchase.lines.flatMap((line) => {
      const raw = returnQty[line.id];
      const qty = raw ? parseQuantity(raw, precisionFor(line.unitCode)) : null;
      if (!qty || qty <= 0) return [];
      return [{ purchaseItemId: line.id, quantityMilli: qty }];
    });

    if (lines.length === 0) {
      setError('Enter a quantity against at least one item.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Give a reason for the return.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await call('purchases:createReturn', {
        idempotencyKey: crypto.randomUUID(),
        purchaseId,
        reason: reason.trim(),
        settlement,
        lines,
      });
      await load();
      setMode('view');
      setReturnQty({});
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment() {
    if (!purchase) return;
    const paise = parseRupees(payAmount);
    if (!paise || paise <= 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('purchases:payment', {
        supplierId: purchase.supplierId,
        purchaseId,
        method: payMethod,
        amountPaise: paise,
        reference: reference.trim() || null,
      });
      await load();
      setMode('view');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    setBusy(true);
    setError(null);
    try {
      await call('purchases:cancel', { id: purchaseId, reason: reason.trim() });
      await load();
      setMode('view');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const cancelled = purchase?.status === 'cancelled';
  const canReturn =
    purchase && !cancelled && purchase.lines.some((l) => l.quantityMilli > l.returnedMilli);

  return (
    <Modal
      title={purchase ? `Purchase ${purchase.purchaseNumber}` : 'Purchase'}
      onClose={onClose}
      width={780}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {purchase && !cancelled && mode === 'view' && (
            <>
              <button className="btn-warn" onClick={() => setMode('cancel')}>
                <Ban size={15} /> Cancel bill
              </button>
              {canReturn && (
                <button className="btn-secondary" onClick={() => setMode('return')}>
                  <Undo2 size={15} /> Return items
                </button>
              )}
              {purchase.outstandingPaise > 0 && (
                <button className="btn-primary" onClick={() => setMode('pay')}>
                  <Wallet size={15} /> Pay {formatPaise(purchase.outstandingPaise)}
                </button>
              )}
            </>
          )}
          {mode === 'return' && (
            <button className="btn-primary" onClick={() => void submitReturn()} disabled={busy}>
              {busy ? 'Sending back…' : 'Return to supplier'}
            </button>
          )}
          {mode === 'pay' && (
            <button className="btn-primary" onClick={() => void submitPayment()} disabled={busy}>
              {busy ? 'Recording…' : 'Record payment'}
            </button>
          )}
          {mode === 'cancel' && (
            <button className="btn-danger" onClick={() => void submitCancel()} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel this bill'}
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

      {!purchase ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          {cancelled && (
            <p className="void-banner" role="status">
              <strong>Cancelled</strong>
              {purchase.cancelledAt ? ` on ${formatDateTime(purchase.cancelledAt)}` : ''}
              {purchase.cancelReason ? ` — ${purchase.cancelReason}` : ''}
            </p>
          )}

          <dl className="facts">
            <dt>Supplier</dt>
            <dd>{purchase.supplierName ?? '—'}</dd>
            <dt>Their bill</dt>
            <dd>{purchase.supplierBillNo ?? '—'}</dd>
            <dt>Date</dt>
            <dd>{formatDateTime(purchase.purchaseDate)}</dd>
            <dt>Prices</dt>
            <dd>{purchase.taxMode === 'inclusive' ? 'GST included' : 'GST added on top'}</dd>
          </dl>

          <div className="table-wrap" style={{ margin: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Cost</th>
                  <th className="num">Tax</th>
                  <th className="num">Total</th>
                  {mode === 'return' && <th className="num">Return</th>}
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((line) => {
                  const precision = precisionFor(line.unitCode);
                  const left = line.quantityMilli - line.returnedMilli;
                  return (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.name}</strong>
                        {line.returnedMilli > 0 && (
                          <span className="sub-cell">
                            {formatQuantity(line.returnedMilli, precision)} {line.unitCode} returned
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {formatQuantity(line.quantityMilli, precision)} {line.unitCode}
                      </td>
                      <td className="num">{formatPaise(line.unitCostPaise)}</td>
                      <td className="num">
                        {formatPaise(line.taxPaise)}
                        <span className="sub-cell">{(line.taxRateBp / 100).toFixed(0)}%</span>
                      </td>
                      <td className="num">{formatPaise(line.totalPaise)}</td>
                      {mode === 'return' && (
                        <td className="num">
                          <input
                            className="price-input"
                            placeholder="0"
                            disabled={left <= 0}
                            value={returnQty[line.id] ?? ''}
                            onChange={(e) =>
                              setReturnQty((q) => ({ ...q, [line.id]: e.target.value }))
                            }
                          />
                          <span className="sub-cell">{formatQuantity(left, precision)} left</span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mode === 'return' && (
            <div className="row" style={{ marginTop: 16 }}>
              <Field label="Reason" htmlFor="pd-reason" required>
                <input
                  id="pd-reason"
                  value={reason}
                  placeholder="Damaged, short supplied, wrong item…"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Field label="Settled by" htmlFor="pd-settlement" required>
                <select
                  id="pd-settlement"
                  value={settlement}
                  onChange={(e) => setSettlement(e.target.value as PurchaseSettlement)}
                >
                  {PURCHASE_SETTLEMENTS.map((s) => (
                    <option key={s} value={s}>
                      {s === 'debit_note' ? 'Debit note on their account' : s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {mode === 'pay' && (
            <>
              <div className="row" style={{ marginTop: 16 }}>
                <Field label="Amount" htmlFor="pd-amount" required>
                  <input
                    id="pd-amount"
                    className="price-input"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </Field>
                <Field label="Method" htmlFor="pd-method" required>
                  <select
                    id="pd-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as SupplierPaymentMethod)}
                  >
                    {SUPPLIER_PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Reference" htmlFor="pd-ref">
                <input
                  id="pd-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </>
          )}

          {mode === 'cancel' && (
            <>
              <p className="warn-note" style={{ marginTop: 16 }}>
                <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Everything this bill brought in goes straight back out of stock. The bill keeps its
                number and stays in the list, marked cancelled.
              </p>
              <Field label="Reason" htmlFor="pd-cancel-reason" required>
                <input
                  id="pd-cancel-reason"
                  value={reason}
                  autoFocus
                  placeholder="Entered twice, wrong supplier…"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </>
          )}

          <div className="detail-foot">
            <div className="detail-payments">
              <h3>Payments</h3>
              {purchase.payments.length === 0 ? (
                <p className="field-hint">Nothing paid yet.</p>
              ) : (
                <ul>
                  {purchase.payments.map((p) => (
                    <li key={p.id} className={p.amountPaise < 0 ? 'muted' : ''}>
                      <span>
                        {p.method.toUpperCase()}
                        {p.reference ? ` · ${p.reference}` : ''}
                        <span className="sub-cell">{formatDateTime(p.paymentDate)}</span>
                      </span>
                      <strong>{formatPaise(p.amountPaise)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="totals">
              <div className="t-row">
                <span>Taxable</span>
                <span>{formatPaise(purchase.taxablePaise)}</span>
              </div>
              {purchase.isInterstate ? (
                <div className="t-row small">
                  <span>IGST</span>
                  <span>{formatPaise(purchase.igstPaise)}</span>
                </div>
              ) : (
                <>
                  <div className="t-row small">
                    <span>CGST</span>
                    <span>{formatPaise(purchase.cgstPaise)}</span>
                  </div>
                  <div className="t-row small">
                    <span>SGST</span>
                    <span>{formatPaise(purchase.sgstPaise)}</span>
                  </div>
                </>
              )}
              {purchase.roundOffPaise !== 0 && (
                <div className="t-row small">
                  <span>Round off</span>
                  <span>
                    {purchase.roundOffPaise > 0 ? '+' : '−'}
                    {formatPaise(Math.abs(purchase.roundOffPaise))}
                  </span>
                </div>
              )}
              <div className="t-row grand">
                <span>Total</span>
                <span>{formatPaise(purchase.totalPaise)}</span>
              </div>
              {purchase.returnedPaise > 0 && (
                <div className="t-row">
                  <span>Returned</span>
                  <span>−{formatPaise(purchase.returnedPaise)}</span>
                </div>
              )}
              <div className="t-row">
                <span>Paid</span>
                <span>{formatPaise(purchase.paidPaise)}</span>
              </div>
              <div className="t-row">
                <span>Still owed</span>
                <span>{formatPaise(purchase.outstandingPaise)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
