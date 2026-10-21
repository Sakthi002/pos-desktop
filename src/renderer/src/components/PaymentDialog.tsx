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
  credit,
  canOpenAccount,
  onOpenAccount,
  onConfirm,
  onClose,
}: {
  totalPaise: number;
  settings: AppSettings;
  busy: boolean;
  error: string | null;
  /** Present when this customer may leave part of the bill on their account. */
  credit?: { customerName: string; owesPaise: number } | null;
  /** Whether this operator is allowed to open one from here. */
  canOpenAccount?: boolean;
  /** Opens the account, puts it on the bill, and resolves once both are done. */
  onOpenAccount?: (input: { name: string; phone: string }) => Promise<void>;
  onConfirm: (payments: PaymentInput[], onCredit: boolean) => void;
  onClose: () => void;
}) {
  const methods = settings.payment.methods;
  const firstMethod: PaymentMethod = methods[0] ?? 'cash';

  const [rows, setRows] = useState<Row[]>([
    { method: firstMethod, amount: (totalPaise / 100).toFixed(2), reference: '' },
  ]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [onCredit, setOnCredit] = useState(false);
  /** Whether the operator has had their say about the tick below. */
  const [creditTouched, setCreditTouched] = useState(false);
  // Opening an account mid-bill: a walk-in who wants to pay the rest later has
  // to become somebody the shop can ask.
  const [opening, setOpening] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const parsedRows = useMemo(
    () => rows.map((r) => ({ ...r, paise: parseRupees(r.amount) })),
    [rows],
  );

  const paid = parsedRows.reduce((a, r) => a + (r.paise ?? 0), 0);
  const outstanding = totalPaise - paid;
  const change = paid > totalPaise ? paid - totalPaise : 0;
  const hasCash = parsedRows.some((r) => r.method === 'cash');
  // A bill that falls short, against a customer whose account can carry it, is
  // a bill going on account: the tick starts on and follows the figures until
  // the operator unticks it, after which it stays where they put it. Nothing
  // is decided by the tick alone — the button reads "On account" before it is
  // pressed, so credit is still given knowingly.
  const putOnAccount = creditTouched ? onCredit : Boolean(credit) && outstanding > 0;

  const setCredit = (next: boolean) => {
    setOnCredit(next);
    setCreditTouched(true);
    setLocalError(null);
  };

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

  async function openAccount() {
    if (!onOpenAccount) return;
    const name = newName.trim();
    if (!name) {
      setLocalError('Enter a name for the account.');
      return;
    }

    setSaving(true);
    try {
      await onOpenAccount({ name, phone: newPhone.trim() });
      setOpening(false);
      // The account exists now, so the tick turns itself on with the figures.
      setCreditTouched(false);
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function confirm() {
    if (parsedRows.some((r) => r.paise === null)) {
      setLocalError('One of the amounts is not a valid figure.');
      return;
    }
    if (paid < totalPaise && !putOnAccount) {
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
      putOnAccount,
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
            {busy
              ? 'Saving…'
              : putOnAccount
                ? `On account · ${formatPaise(totalPaise)}`
                : `Complete sale · ${formatPaise(totalPaise)}`}
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
        <button className="btn-info small" onClick={addRow}>
          + Split payment
        </button>
      )}

      <div className="pay-summary">
        {outstanding > 0 && <p className="outstanding">Still to pay: {formatPaise(outstanding)}</p>}

        {credit && outstanding > 0 && (
          <label className="check" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={putOnAccount}
              onChange={(e) => setCredit(e.target.checked)}
            />
            <span>
              Put {formatPaise(outstanding)} on account for <strong>{credit.customerName}</strong>
              <em>
                {credit.owesPaise > 0
                  ? `They already owe ${formatPaise(credit.owesPaise)}.`
                  : 'Nothing owing on this account yet.'}
              </em>
            </span>
          </label>
        )}
        {/* Short, with no account to put the rest on. Rather than refusing the
            sale and leaving the cashier to guess, the way out is offered here:
            a walk-in can be given an account without losing the bill. */}
        {!credit && outstanding > 0 && (
          <div className="pay-credit">
            {!onOpenAccount || !canOpenAccount ? (
              <p>
                The rest of a bill can only be left on a customer&rsquo;s account. Choose a customer
                before taking payment.
              </p>
            ) : opening ? (
              <div className="new-account">
                <Field label="Name" required>
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Who is taking the credit"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    inputMode="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="For the reminder later"
                  />
                </Field>
                <div className="new-account-foot">
                  <button
                    className="btn-secondary small"
                    onClick={() => setOpening(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-info small"
                    onClick={() => void openAccount()}
                    disabled={saving}
                  >
                    {saving ? 'Opening…' : 'Open the account'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p>A walk-in has no account for the rest of the bill to sit on.</p>
                <button
                  className="btn-info small"
                  onClick={() => {
                    setOpening(true);
                    setLocalError(null);
                  }}
                >
                  + Open an account for this customer
                </button>
              </>
            )}
          </div>
        )}

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
