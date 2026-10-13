import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, PenLine } from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from './Field';
import { Modal } from './Modal';
import { JournalDialog } from './JournalDialog';
import { formatPaise, parseRupees } from '@shared/money';
import { ACCOUNTS, type AccountBalance, type LedgerStatement } from '@shared/ledger';

const ALL_TIME = {
  fromIso: '2000-01-01T00:00:00.000Z',
  toIso: '2100-01-01T00:00:00.000Z',
};

/**
 * The books, as a shopkeeper needs to see them: where the money sits, what is
 * owed each way, and where GST stands. Everything here is posted automatically
 * from sales, purchases and payments — the only thing to enter by hand is what
 * the shop already held on the day it started using this.
 */
export function BooksPanel() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);

  const [viewing, setViewing] = useState<string | null>(null);
  const [journal, setJournal] = useState(true);
  const [statement, setStatement] = useState<LedgerStatement | null>(null);

  const [cash, setCash] = useState('');
  const [bank, setBank] = useState('');
  const [receivable, setReceivable] = useState('');
  const [payable, setPayable] = useState('');

  const load = useCallback(async () => {
    try {
      setBalances(await call('ledger:trialBalance', ALL_TIME));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function openStatement(code: string) {
    setViewing(code);
    setStatement(null);
    try {
      setStatement(await call('ledger:statement', { accountCode: code, ...ALL_TIME, limit: 500 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const balanceOf = (code: string) => balances.find((b) => b.code === code)?.balancePaise ?? 0;
  const alreadyOpened = balanceOf(ACCOUNTS.openingBalance) !== 0;
  const debit = balances.reduce((a, b) => a + b.debitPaise, 0);
  const credit = balances.reduce((a, b) => a + b.creditPaise, 0);

  async function postOpening() {
    setBusy(true);
    setError(null);
    try {
      await call('ledger:openingBalances', {
        cashPaise: parseRupees(cash) ?? 0,
        bankPaise: parseRupees(bank) ?? 0,
        receivablePaise: parseRupees(receivable) ?? 0,
        payablePaise: parseRupees(payable) ?? 0,
        asOfIso: new Date().toISOString(),
      });
      setMessage('Opening balances posted.');
      setOpening(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const cards = [
    { label: 'Cash in hand', value: balanceOf(ACCOUNTS.cash) },
    { label: 'Bank', value: balanceOf(ACCOUNTS.bank) },
    { label: 'Card and UPI', value: balanceOf(ACCOUNTS.card) + balanceOf(ACCOUNTS.upi) },
    { label: 'Customers owe us', value: balanceOf(ACCOUNTS.receivable) },
    { label: 'We owe suppliers', value: balanceOf(ACCOUNTS.payable) },
    {
      label: 'GST payable, net of input',
      value: balanceOf(ACCOUNTS.gstOutput) - balanceOf(ACCOUNTS.gstInput),
    },
  ];

  return (
    <>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="preview-ok" role="status">
          <CheckCircle2 size={14} /> {message}
        </p>
      )}

      <p className="field-hint" style={{ marginBottom: 16 }}>
        Every sale, return, purchase and payment posts itself to the books as it happens. Nothing
        here is typed in twice.
      </p>

      <div className="dash-row" style={{ marginBottom: 18 }}>
        {cards.map((card) => (
          <div className="stat" key={card.label}>
            <span className="stat-label">{card.label}</span>
            <strong className="stat-value">{formatPaise(card.value)}</strong>
          </div>
        ))}
      </div>

      <section className="panel-card" style={{ marginBottom: 16 }}>
        <header>
          <PenLine size={16} />
          <h2>Expenses and transfers</h2>
          <button
            className="btn-secondary small"
            style={{ marginLeft: 'auto' }}
            onClick={() => setJournal(true)}
          >
            Record an entry
          </button>
        </header>
        <div style={{ padding: '16px 20px' }}>
          <p className="field-hint" style={{ margin: 0 }}>
            Rent, wages, electricity, money moved to the bank — anything the shop spends that no
            bill in here covers. Without these the books know what came in and not what went out.
          </p>
        </div>
      </section>

      <section className="panel-card" style={{ marginBottom: 16 }}>
        <header>
          <BookOpen size={16} />
          <h2>Trial balance</h2>
          <span
            className={debit === credit ? 'badge ok' : 'badge err'}
            style={{ marginLeft: 'auto' }}
          >
            {debit === credit ? 'In balance' : 'Out of balance'}
          </span>
        </header>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {balances
                .filter((b) => b.debitPaise + b.creditPaise > 0)
                .map((b) => (
                  <tr
                    key={b.code}
                    className="clickable"
                    onClick={() => void openStatement(b.code)}
                    title="See every entry on this account"
                  >
                    <td className="mono">{b.code}</td>
                    <td>
                      <strong>{b.name}</strong>
                      <span className="sub-cell">{b.group}</span>
                    </td>
                    <td className="num">{b.debitPaise ? formatPaise(b.debitPaise) : '—'}</td>
                    <td className="num">{b.creditPaise ? formatPaise(b.creditPaise) : '—'}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total</td>
                <td className="num">{formatPaise(debit)}</td>
                <td className="num">{formatPaise(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel-card">
        <header>
          <h2>Opening balances</h2>
        </header>
        <div style={{ padding: '16px 20px' }}>
          {alreadyOpened ? (
            <p className="field-hint" style={{ margin: 0 }}>
              Posted. What the shop held before it started using this software is on the books, and
              can only be corrected by a journal entry.
            </p>
          ) : !opening ? (
            <>
              <p className="field-hint" style={{ marginTop: 0 }}>
                If the shop was trading before today, enter what it held when the books started:
                cash in the drawer, money in the bank, what customers owed and what was owed to
                suppliers. This is posted once.
              </p>
              <button className="btn-secondary" onClick={() => setOpening(true)}>
                Enter opening balances
              </button>
            </>
          ) : (
            <>
              <div className="row">
                <Field label="Cash in hand" htmlFor="ob-cash">
                  <input
                    id="ob-cash"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                  />
                </Field>
                <Field label="In the bank" htmlFor="ob-bank">
                  <input
                    id="ob-bank"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                  />
                </Field>
              </div>
              <div className="row">
                <Field label="Customers owed us" htmlFor="ob-receivable">
                  <input
                    id="ob-receivable"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={receivable}
                    onChange={(e) => setReceivable(e.target.value)}
                  />
                </Field>
                <Field label="We owed suppliers" htmlFor="ob-payable">
                  <input
                    id="ob-payable"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={payable}
                    onChange={(e) => setPayable(e.target.value)}
                  />
                </Field>
              </div>
              <div className="page-actions">
                <button className="btn-secondary" onClick={() => setOpening(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => void postOpening()} disabled={busy}>
                  {busy ? 'Posting…' : 'Post opening balances'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {journal && (
        <JournalDialog
          onClose={() => setJournal(false)}
          onPosted={() => {
            setJournal(false);
            setMessage('Entry posted to the books.');
            void load();
          }}
        />
      )}

      {viewing && (
        <Modal
          title={statement ? `${statement.account.code} · ${statement.account.name}` : 'Account'}
          onClose={() => setViewing(null)}
          width={760}
        >
          {!statement ? (
            <p className="field-hint">Reading the account…</p>
          ) : statement.lines.length === 0 ? (
            <p className="field-hint">Nothing posted to this account yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Narration</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{new Date(line.entryDate).toLocaleDateString()}</td>
                      <td className="mono">{line.voucherNo}</td>
                      <td>{line.narration ?? '—'}</td>
                      <td className="num">
                        {line.debitPaise ? formatPaise(line.debitPaise) : '—'}
                      </td>
                      <td className="num">
                        {line.creditPaise ? formatPaise(line.creditPaise) : '—'}
                      </td>
                      <td className="num">{formatPaise(line.balancePaise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Closing balance</td>
                    <td className="num">{formatPaise(statement.closingPaise)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
