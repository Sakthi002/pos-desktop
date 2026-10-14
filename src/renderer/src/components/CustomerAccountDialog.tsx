import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Wallet } from 'lucide-react';
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
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');

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

  async function receive() {
    const paise = parseRupees(amount);
    if (!paise || paise <= 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('counter:receive', {
        customerId: customer.id,
        saleId: saleId || null,
        method,
        amountPaise: paise,
      });
      setAmount('');
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
          <button className="btn-success" onClick={() => setSending(true)} disabled={!account}>
            <MessageCircle size={15} /> Send the account
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
            <div className="stat">
              <div className="stat-text">
                <span className="stat-label">Credit limit</span>
                <strong className="stat-value">
                  {account.creditLimitPaise > 0
                    ? formatPaise(account.creditLimitPaise)
                    : 'Cash only'}
                </strong>
                {account.availablePaise !== null && (
                  <span className="stat-note">
                    {formatPaise(account.availablePaise)} left before it stops a sale
                  </span>
                )}
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
                <Field label="How" htmlFor="ac-method" plainLabel>
                  <select
                    id="ac-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount" htmlFor="ac-amount" required>
                  <input
                    id="ac-amount"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
              </div>
              <div className="page-actions">
                <button className="btn-success" onClick={() => void receive()} disabled={busy}>
                  <Wallet size={15} /> {busy ? 'Recording…' : 'Record what they paid'}
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
