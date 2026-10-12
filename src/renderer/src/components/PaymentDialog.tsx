import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { formatPaise, parseRupees } from '@shared/money';
import { PAYMENT_METHOD_LABELS, type AppSettings } from '@shared/settings';
import type { PaymentInput, PaymentMethod } from '@shared/sale';

interface Row {
  method: PaymentMethod;
  amount: string;
  reference: string;
}

/**
 * Takes payment. Supports splitting across methods, and calculates change on
 * the cash portion. The amount owed is recomputed as rows change so the
 * operator can see what is still outstanding.
 */
export function PaymentDialog({
  totalPaise,
  settings,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  totalPaise: number;
  settings: AppSettings;
  busy: boolean;
  error: string | null;
  onConfirm: (payments: PaymentInput[]) => void;
  onClose: () => void;
}) {
  const methods = settings.payment.methods;
  const firstMethod: PaymentMethod = methods[0] ?? 'cash';

  const [rows, setRows] = useState<Row[]>([
    { method: firstMethod, amount: (totalPaise / 100).toFixed(2), reference: '' },
  ]);
  const [localError, setLocalError] = useState<string | null>(null);

  const parsedRows = useMemo(
    () => rows.map((r) => ({ ...r, paise: parseRupees(r.amount) })),
    [rows],
  );

  const paid = parsedRows.reduce((a, r) => a + (r.paise ?? 0), 0);
  const outstanding = totalPaise - paid;
  const change = paid > totalPaise ? paid - totalPaise : 0;
  const hasCash = parsedRows.some((r) => r.method === 'cash');

  const update = (index: number, patch: Partial<Row>) => {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setLocalError(null);
  };

  const addRow = () => {
    const remaining = Math.max(0, outstanding);
    setRows((current) => [
      ...current,
      {
        method: methods.find((m) => !current.some((r) => r.method === m)) ?? firstMethod,
        amount: remaining > 0 ? (remaining / 100).toFixed(2) : '',
        reference: '',
      },
    ]);
  };

  function confirm() {
    if (parsedRows.some((r) => r.paise === null)) {
      setLocalError('One of the amounts is not a valid figure.');
      return;
    }
    if (paid < totalPaise) {
      setLocalError(`${formatPaise(outstanding)} still to pay.`);
      return;
    }
    if (change > 0 && !hasCash) {
      setLocalError('Change can only be given against cash. Reduce the amount.');
      return;
    }

    onConfirm(
      parsedRows
        .filter((r) => (r.paise ?? 0) > 0)
        .map((r) => ({
          method: r.method,
          amountPaise: r.paise as number,
          tenderedPaise: r.method === 'cash' ? (r.paise as number) : null,
          reference: r.reference.trim() || null,
        })),
    );
  }

  return (
    <Modal
      title="Take payment"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={confirm} disabled={busy}>
            {busy ? 'Saving…' : `Complete sale · ${formatPaise(totalPaise)}`}
          </button>
        </>
      }
    >
      {(error ?? localError) && (
        <p className="field-error" role="alert">
          {error ?? localError}
        </p>
      )}

      <div className="pay-total">
        <span>Amount due</span>
        <strong>{formatPaise(totalPaise)}</strong>
      </div>

      {rows.map((row, i) => (
        <div className="pay-row" key={i}>
          <select
            value={row.method}
            onChange={(e) => update(i, { method: e.target.value as PaymentMethod })}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>

          <input
            inputMode="decimal"
            value={row.amount}
            autoFocus={i === 0}
            onChange={(e) => update(i, { amount: e.target.value })}
            placeholder="0.00"
          />

          {row.method !== 'cash' && (
            <input
              value={row.reference}
              onChange={(e) => update(i, { reference: e.target.value })}
              placeholder="Reference"
            />
          )}

          {rows.length > 1 && (
            <button
              className="icon-btn danger"
              onClick={() => setRows((c) => c.filter((_, idx) => idx !== i))}
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {rows.length < methods.length && (
        <button className="btn-secondary small" onClick={addRow}>
          + Split payment
        </button>
      )}

      <div className="pay-summary">
        {outstanding > 0 && <p className="outstanding">Still to pay: {formatPaise(outstanding)}</p>}
        {change > 0 && (
          <p className="change">
            Change due: <strong>{formatPaise(change)}</strong>
          </p>
        )}
      </div>

      <Field
        label=""
        hint="The app records the method and amount you enter. It does not verify a UPI or card payment with any provider."
      >
        <span />
      </Field>
    </Modal>
  );
}
