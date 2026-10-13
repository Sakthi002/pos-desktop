import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { parseRupees } from '@shared/money';
import { ACCOUNT_GROUPS, type Account, type AccountGroup } from '@shared/ledger';

const todayValue = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A date the operator picked is a local day; the books store an instant. */
const instantOf = (value: string): string | null => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
};

const GROUP_LABEL: Record<AccountGroup, string> = {
  asset: 'Something the shop owns',
  liability: 'Something the shop owes',
  equity: "The owner's money",
  income: 'Money coming in',
  expense: 'Money going out',
};

/**
 * Rent, wages, electricity, a transfer to the bank: real money that no
 * document in this app issues. It is entered as a proper voucher with two
 * sides, so the books stay a complete account of the shop rather than a record
 * of its sales only.
 */
export function JournalDialog({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromCode, setFromCode] = useState('1100');
  const [toCode, setToCode] = useState('');
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [date, setDate] = useState(todayValue());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<AccountGroup>('expense');

  useEffect(() => {
    void call('ledger:accounts')
      .then(setAccounts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function addAccount() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const account = await call('ledger:createAccount', { name: newName.trim(), group: newGroup });
      setAccounts(await call('ledger:accounts'));
      setToCode(account.code);
      setAdding(false);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    const paise = parseRupees(amount);
    const dateIso = instantOf(date);
    if (!paise || paise <= 0) return setError('Enter an amount.');
    if (!toCode) return setError('Choose what this was for.');
    if (fromCode === toCode) return setError('The two sides must be different accounts.');
    if (!narration.trim()) return setError('Write what this entry is for.');
    if (!dateIso) return setError('Choose a date.');

    setBusy(true);
    setError(null);
    try {
      await call('ledger:journal', {
        dateIso,
        narration: narration.trim(),
        lines: [
          { accountCode: toCode, debitPaise: paise, creditPaise: 0 },
          { accountCode: fromCode, debitPaise: 0, creditPaise: paise },
        ],
      });
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const option = (a: Account) => (
    <option key={a.code} value={a.code}>
      {a.code} · {a.name}
    </option>
  );

  return (
    <Modal
      title="Record an expense or transfer"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void post()} disabled={busy}>
            {busy ? 'Posting…' : 'Post entry'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        <Field label="Date" htmlFor="j-date" required>
          <input
            id="j-date"
            type="date"
            value={date}
            max={todayValue()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Amount" htmlFor="j-amount" required>
          <input
            id="j-amount"
            className="price-input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Money came out of"
        htmlFor="j-from"
        hint="Cash in the drawer, or the bank"
        required
      >
        <select id="j-from" value={fromCode} onChange={(e) => setFromCode(e.target.value)}>
          {accounts.filter((a) => a.group === 'asset').map(option)}
        </select>
      </Field>

      <Field label="What it was for" htmlFor="j-to" required>
        <select id="j-to" value={toCode} onChange={(e) => setToCode(e.target.value)}>
          <option value="">Choose an account</option>
          {accounts.filter((a) => a.code !== fromCode).map(option)}
        </select>
      </Field>

      {!adding ? (
        <button className="link-btn" style={{ marginBottom: 14 }} onClick={() => setAdding(true)}>
          The account I need is not listed
        </button>
      ) : (
        <div className="panel-card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row">
            <Field label="Account name" htmlFor="j-new-name" required>
              <input
                id="j-new-name"
                value={newName}
                placeholder="Shop rent"
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <Field label="What kind" htmlFor="j-new-group" required>
              <select
                id="j-new-group"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value as AccountGroup)}
              >
                {ACCOUNT_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="page-actions">
            <button className="btn-secondary" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn-secondary" onClick={() => void addAccount()} disabled={busy}>
              Add account
            </button>
          </div>
        </div>
      )}

      <Field label="What is it for" htmlFor="j-narration" required>
        <input
          id="j-narration"
          value={narration}
          placeholder="October rent"
          onChange={(e) => setNarration(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
