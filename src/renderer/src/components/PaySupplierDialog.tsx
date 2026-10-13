import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import {
  SUPPLIER_PAYMENT_METHODS,
  type PurchaseSummary,
  type SupplierPaymentMethod,
  type SupplierSummary,
} from '@shared/purchasing';

/**
 * Paying a supplier. A payment can sit against one bill or on the account,
 * which is how shops actually settle — a round figure on market day, allocated
 * later or never.
 */
export function PaySupplierDialog({
  supplier,
  purchase,
  onClose,
  onPaid,
}: {
  supplier: SupplierSummary;
  /** Pre-selected when paying from a bill rather than from the supplier. */
  purchase?: PurchaseSummary | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [bills, setBills] = useState<PurchaseSummary[]>([]);
  const [purchaseId, setPurchaseId] = useState(purchase?.id ?? '');
  const [method, setMethod] = useState<SupplierPaymentMethod>('cash');
  const [amount, setAmount] = useState(
    purchase ? (purchase.outstandingPaise / 100).toFixed(2) : '',
  );
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (purchase) return;
    let cancelled = false;
    void call('purchases:search', { supplierId: supplier.id, unpaidOnly: true, pageSize: 50 })
      .then((page) => {
        if (!cancelled) setBills(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supplier.id, purchase]);

  const selected = bills.find((b) => b.id === purchaseId) ?? purchase ?? null;

  async function pay() {
    const paise = parseRupees(amount);
    if (!paise || paise <= 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('purchases:payment', {
        supplierId: supplier.id,
        purchaseId: purchaseId || null,
        method,
        amountPaise: paise,
        reference: reference.trim() || null,
      });
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Pay ${supplier.name}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-success" onClick={() => void pay()} disabled={busy}>
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="current-stock">
        Outstanding with this supplier: <strong>{formatPaise(supplier.outstandingPaise)}</strong>
      </div>

      {!purchase && (
        <Field label="Against a bill" htmlFor="p-bill" hint="Leave as on account to allocate later">
          <select
            id="p-bill"
            value={purchaseId}
            onChange={(e) => {
              setPurchaseId(e.target.value);
              const bill = bills.find((b) => b.id === e.target.value);
              if (bill) setAmount((bill.outstandingPaise / 100).toFixed(2));
            }}
          >
            <option value="">On account</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.purchaseNumber} · {formatPaise(b.outstandingPaise)} due
              </option>
            ))}
          </select>
        </Field>
      )}

      {selected && (
        <p className="field-hint" style={{ marginTop: -8, marginBottom: 14 }}>
          {selected.purchaseNumber} has {formatPaise(selected.outstandingPaise)} outstanding.
        </p>
      )}

      <div className="row">
        <Field label="Amount" htmlFor="p-amount" required>
          <input
            id="p-amount"
            className="price-input"
            inputMode="decimal"
            autoFocus
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Method" htmlFor="p-method" required>
          <select
            id="p-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as SupplierPaymentMethod)}
          >
            {SUPPLIER_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Reference" htmlFor="p-ref" hint="Cheque number, UPI reference, anything">
        <input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
    </Modal>
  );
}
