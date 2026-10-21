import { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { WhatsAppIcon } from './WhatsAppIcon';
import { Modal } from './Modal';
import { WhatsAppDialog } from './WhatsAppDialog';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import { PAYMENT_METHODS, type PaymentMethod } from '@shared/sale';
import type { CustomerAccount, CustomerReceipt } from '@shared/trade';
import type { CustomerSummary } from '@shared/customer';

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * One customer's account: the bills they have not settled, and taking money
 * against them. A receipt can sit on one bill or on the account, which is how
 * shops are actually paid — a round figure on the way past, allocated or not.
 */
export function CustomerAccountDialog({
  customer,
  onClose,
}: {
  customer: CustomerSummary;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [receipts, setReceipts] = useState<CustomerReceipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const [saleId, setSaleId] = useState('');
  // Money comes over the counter in more than one form — half cash, half UPI —
  // and that is one payment, so it is entered as one.
  const [parts, setParts] = useState<{ method: PaymentMethod; amount: string }[]>([
    { method: 'cash', amount: '' },
  ]);

  const load = useCallback(async () => {
    try {
      const [next, list] = await Promise.all([
        call('counter:account', { customerId: customer.id }),
        call('counter:receipts', { customerId: customer.id }),
      ]);
      setAccount(next);
      setReceipts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [customer.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  // What this payment comes to, and what the part being added should default
  // to: whatever is left of the bill or the balance it is going against.
  const entered = parts.reduce((a, part) => a + (parseRupees(part.amount) ?? 0), 0);
  const due = saleId
    ? (account?.bills.find((b) => b.saleId === saleId)?.outstandingPaise ?? 0)
    : (account?.outstandingPaise ?? 0);

  const addPart = () => {
    const left = Math.max(0, due - entered);
    setParts((current) => [
      ...current,
      {
        method: PAYMENT_METHODS.find((m) => !current.some((p) => p.method === m)) ?? 'cash',
        amount: left > 0 ? (left / 100).toFixed(2) : '',
      },
    ]);
  };

  async function receive() {
    if (parts.some((part) => part.amount.trim() !== '' && parseRupees(part.amount) === null)) {
      setError('One of the amounts is not a valid figure.');
      return;
    }
    const taken = parts
      .map((part) => ({ method: part.method, amountPaise: parseRupees(part.amount) ?? 0 }))
      .filter((part) => part.amountPaise > 0);
    if (taken.length === 0) {
      setError('Enter an amount.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await call('counter:receiveSplit', {
        customerId: customer.id,
        saleId: saleId || null,
        parts: taken,
      });
      setParts([{ method: 'cash', amount: '' }]);
      setSaleId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${customer.name} — account`}
      onClose={onClose}
      width={720}
      footer={
        <>
          <span className="field-hint">
            A statement is drawn as it stands now — it is not a bill and asks for nothing new.
          </span>
          <button className="btn-whatsapp" onClick={() => setSending(true)} disabled={!account}>
            <WhatsAppIcon /> Send the account
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {account && (
        <>
          <div className="dash-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-text">
                <span className="stat-label">Owes us</span>
                <strong className="stat-value">{formatPaise(account.outstandingPaise)}</strong>
              </div>
            </div>
          </div>

          {account.outstandingPaise > 0 && (
            <section className="panel-card" style={{ padding: 14, marginBottom: 16 }}>
              <div className="row">
                <Field
                  label="Against a bill"
                  htmlFor="ac-bill"
                  hint="Or leave it on account"
                  plainLabel
                >
                  <select id="ac-bill" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                    <option value="">On account</option>
                    {account.bills
                      .filter((b) => b.outstandingPaise > 0)
                      .map((b) => (
                        <option key={b.saleId} value={b.saleId}>
                          {b.invoiceNumber} · {formatPaise(b.outstandingPaise)} due
                        </option>
                      ))}
                  </select>
                </Field>
              </div>

              {parts.map((part, i) => (
                <div className="pay-row" key={i}>
                  <select
                    value={part.method}
                    aria-label="How they paid"
                    onChange={(e) =>
                      setParts((current) =>
                        current.map((p, idx) =>
                          idx === i ? { ...p, method: e.target.value as PaymentMethod } : p,
                        ),
                      )
                    }
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <input
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Amount"
                    value={part.amount}
                    onChange={(e) =>
                      setParts((current) =>
                        current.map((p, idx) => (idx === i ? { ...p, amount: e.target.value } : p)),
                      )
                    }
                  />
                  {parts.length > 1 && (
                    <button
                      className="icon-btn danger"
                      title="Remove"
                      onClick={() => setParts((current) => current.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              <div className="page-actions">
                {parts.length < PAYMENT_METHODS.length && (
                  <button className="btn-info small" onClick={addPart}>
                    + Split payment
                  </button>
                )}
                <button className="btn-primary" onClick={() => void receive()} disabled={busy}>
                  <Wallet size={15} />{' '}
                  {busy
                    ? 'Recording…'
                    : entered > 0
                      ? `Record ${formatPaise(entered)}`
                      : 'Record what they paid'}
                </button>
              </div>
            </section>
          )}

          {account.bills.length === 0 ? (
            <p className="empty">Nothing outstanding on this account.</p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th className="num">Bill</th>
                    <th className="num">On account</th>
                    <th className="num">Still due</th>
                  </tr>
                </thead>
                <tbody>
                  {account.bills.map((bill) => (
                    <tr
                      key={bill.saleId}
                      className={bill.outstandingPaise === 0 ? 'muted-row' : ''}
                    >
                      <td>
                        <strong>{bill.invoiceNumber}</strong>
                      </td>
                      <td>{formatDate(bill.invoiceDate)}</td>
                      <td className="num">{formatPaise(bill.totalPaise)}</td>
                      <td className="num">{formatPaise(bill.creditPaise)}</td>
                      <td className="num">
                        {bill.outstandingPaise > 0 ? (
                          <strong className="stock low">
                            {formatPaise(bill.outstandingPaise)}
                          </strong>
                        ) : (
                          'Settled'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {receipts.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>How</th>
                    <th>Against</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td>{formatDate(receipt.receiptDate)}</td>
                      <td>{receipt.method.toUpperCase()}</td>
                      <td>{receipt.invoiceNumber ?? 'On account'}</td>
                      <td className="num">{formatPaise(receipt.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sending && (
        <WhatsAppDialog kind="statement" id={customer.id} onClose={() => setSending(false)} />
      )}
    </Modal>
  );
}
