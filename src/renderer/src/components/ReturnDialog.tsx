import { useEffect, useMemo, useState } from 'react';
import { Undo2, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { ApprovalFields } from './ApprovalFields';
import { EMPTY_APPROVAL, needsApproval, type Approval } from '../lib/approval';
import { formatPaise } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import { PAYMENT_METHODS, type PaymentMethod } from '@shared/sale';
import type { ReturnReceipt, ReturnableSale } from '@shared/returns';

interface Draft {
  /** What the operator typed, in display units. */
  quantity: string;
  restock: boolean;
}

/**
 * Takes goods back against one invoice.
 *
 * Quantities are capped at what is still returnable, and the refund is the
 * stored invoice value for those units — the screen never recalculates a price
 * from today's catalogue, because the customer paid yesterday's.
 */
export function ReturnDialog({
  saleId,
  onClose,
  onReturned,
}: {
  saleId: string;
  onClose: () => void;
  onReturned: (credit: ReturnReceipt) => void;
}) {
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('returns:getSale', { saleId })
      .then((data) => {
        if (cancelled) return;
        setSale(data);
        setDrafts(
          Object.fromEntries(
            data.lines.map((line) => [line.saleItemId, { quantity: '', restock: true }]),
          ),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  /** Refund preview: each line's share of its stored value, by quantity. */
  const preview = useMemo(() => {
    if (!sale) return { totalPaise: 0, lines: 0 };
    let totalPaise = 0;
    let lines = 0;
    for (const line of sale.lines) {
      const draft = drafts[line.saleItemId];
      const qty = draft ? parseQuantity(draft.quantity, precisionFor(line.unitCode)) : null;
      if (!qty || qty <= 0 || line.returnableMilli <= 0) continue;
      const capped = Math.min(qty, line.returnableMilli);
      const remainingValue = Math.round(
        (line.totalPaise * line.returnableMilli) / Math.max(line.soldMilli, 1),
      );
      totalPaise += Math.round((remainingValue * capped) / Math.max(line.returnableMilli, 1));
      lines += 1;
    }
    return { totalPaise, lines };
  }, [sale, drafts]);

  function setDraft(saleItemId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [saleItemId]: { quantity: '', restock: true, ...current[saleItemId], ...patch },
    }));
  }

  async function submit() {
    if (!sale) return;

    const lines = sale.lines.flatMap((line) => {
      const draft = drafts[line.saleItemId];
      const qty = draft ? parseQuantity(draft.quantity, precisionFor(line.unitCode)) : null;
      if (!qty || qty <= 0) return [];
      return [
        { saleItemId: line.saleItemId, quantityMilli: qty, restock: draft?.restock ?? false },
      ];
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
      const credit = await call('returns:create', {
        idempotencyKey,
        saleId,
        reason: reason.trim(),
        refundMethod,
        lines,
        ...(approval?.username ? { approval } : {}),
      });
      onReturned(credit);
    } catch (err) {
      // The shop asks for a manager above a value. That is a rule, not an
      // error: show the fields and keep everything already keyed in.
      if (needsApproval(err) && approval === null) {
        setApproval(EMPTY_APPROVAL);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={sale ? `Return against ${sale.invoiceNumber}` : 'Return'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="field-hint" style={{ marginRight: 'auto' }}>
            {preview.lines > 0
              ? `Refund ${formatPaise(preview.totalPaise)} by ${refundMethod.toUpperCase()}`
              : 'Enter the quantity coming back on each line.'}
          </span>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => void submit()}
            disabled={busy || !sale?.canReturn}
          >
            <Undo2 size={15} /> {busy ? 'Refunding…' : 'Refund'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {approval && <ApprovalFields value={approval} onChange={setApproval} />}

      {!sale ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          {!sale.canReturn && (
            <p className="warn-note">
              <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {sale.status === 'voided'
                ? 'This invoice was voided, so the whole sale has already been reversed.'
                : 'Everything on this invoice has already been returned.'}
            </p>
          )}

          {sale.priorReturns.length > 0 && (
            <p className="field-hint">
              Earlier returns:{' '}
              {sale.priorReturns
                .map((r) => `${r.returnNumber} (${formatPaise(r.totalPaise)})`)
                .join(', ')}
            </p>
          )}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Sold</th>
                  <th className="num">Returnable</th>
                  <th className="num">Return qty</th>
                  <th>Resaleable</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((line) => {
                  const precision = precisionFor(line.unitCode);
                  const draft = drafts[line.saleItemId];
                  const spent = line.returnableMilli <= 0;
                  return (
                    <tr key={line.saleItemId} className={spent ? 'muted-row' : ''}>
                      <td>
                        <strong>{line.name}</strong>
                        {line.sku && <span className="sub-cell">{line.sku}</span>}
                      </td>
                      <td className="num">
                        {formatQuantity(line.soldMilli, precision)} {line.unitCode}
                      </td>
                      <td className="num">
                        {formatQuantity(line.returnableMilli, precision)} {line.unitCode}
                      </td>
                      <td className="num qty-cell">
                        <input
                          value={draft?.quantity ?? ''}
                          disabled={spent || !sale.canReturn}
                          placeholder="0"
                          inputMode="decimal"
                          onChange={(e) => setDraft(line.saleItemId, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        {line.trackInventory ? (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={draft?.restock ?? false}
                              disabled={spent || !sale.canReturn}
                              onChange={(e) =>
                                setDraft(line.saleItemId, { restock: e.target.checked })
                              }
                            />
                            <span>Back to stock</span>
                          </label>
                        ) : (
                          <span className="sub-cell">Service</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <Field label="Reason" htmlFor="return-reason" required>
              <input
                id="return-reason"
                value={reason}
                maxLength={200}
                placeholder="Damaged, wrong item, customer changed their mind…"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>

            <Field label="Refund by" htmlFor="return-method" required>
              <select
                id="return-method"
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="field-hint">
            Unticking &ldquo;back to stock&rdquo; refunds the customer without putting the goods
            back on the shelf — for anything damaged or opened.
          </p>
        </>
      )}
    </Modal>
  );
}
