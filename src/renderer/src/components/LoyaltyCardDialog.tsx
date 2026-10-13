import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { LOYALTY_TIERS, TIER_LABELS, type LoyaltyCard, type LoyaltyEntry } from '@shared/loyalty';
import type { LoyaltyTier } from '@shared/loyalty';
import type { CustomerSummary } from '@shared/customer';

const KIND_LABEL: Record<LoyaltyEntry['kind'], string> = {
  earn: 'Earned',
  redeem: 'Used',
  reverse: 'Returned',
  adjust: 'Adjusted',
};

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * One customer's card: issue it, see what moved, and correct it by hand when
 * something was given over the counter that the till never saw. A correction
 * is another entry, never an edit of an old one.
 */
export function LoyaltyCardDialog({
  customer,
  onClose,
}: {
  customer: CustomerSummary;
  onClose: () => void;
}) {
  const [card, setCard] = useState<LoyaltyCard | null>(null);
  const [entries, setEntries] = useState<LoyaltyEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tier, setTier] = useState<LoyaltyTier>('silver');
  const [adjusting, setAdjusting] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const found = await call('loyalty:forCustomer', { customerId: customer.id });
      setCard(found);
      setEntries(found ? await call('loyalty:entries', { cardId: found.id }) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [customer.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      await call('loyalty:issue', { customerId: customer.id, tier });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    const value = Number(points);
    if (!Number.isInteger(value) || value === 0) {
      setError('Enter a whole number of points, positive or negative.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('loyalty:adjust', {
        customerId: customer.id,
        points: value,
        reason: reason.trim(),
      });
      setAdjusting(false);
      setPoints('');
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${customer.name} — points`} onClose={onClose} width={620}>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!loaded ? (
        <p className="empty">Loading…</p>
      ) : !card ? (
        <>
          <p className="field-hint" style={{ marginTop: 0 }}>
            This customer has no card. Issuing one starts them at zero; points are earned from the
            next bill onwards.
          </p>
          <Field label="Tier" htmlFor="lc-tier" required>
            <select
              id="lc-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as LoyaltyTier)}
            >
              {LOYALTY_TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn-primary" onClick={() => void issue()} disabled={busy}>
            {busy ? 'Issuing…' : 'Issue a card'}
          </button>
        </>
      ) : (
        <>
          <div className="dash-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <span className="stat-label">Balance</span>
              <strong className="stat-value">
                <Star size={16} style={{ verticalAlign: '-2px' }} /> {card.balancePoints}
              </strong>
            </div>
            <div className="stat">
              <span className="stat-label">Worth</span>
              <strong className="stat-value">{formatPaise(card.balancePaise)}</strong>
            </div>
            <div className="stat">
              <span className="stat-label">Card</span>
              <strong className="stat-value mono">{card.cardNumber}</strong>
            </div>
          </div>

          {!card.isUsable && (
            <p className="warn-note">
              This card cannot be used — it has expired or been made inactive. The balance stands.
            </p>
          )}

          {!adjusting ? (
            <button
              className="btn-warn small"
              style={{ marginBottom: 14 }}
              onClick={() => setAdjusting(true)}
            >
              Correct the balance
            </button>
          ) : (
            <div className="panel-card" style={{ padding: 14, marginBottom: 14 }}>
              <div className="row">
                <Field
                  label="Points"
                  htmlFor="lc-points"
                  hint="Negative takes points away"
                  required
                >
                  <input
                    id="lc-points"
                    inputMode="numeric"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                </Field>
                <Field label="Why" htmlFor="lc-reason" required>
                  <input
                    id="lc-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
              <div className="page-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setAdjusting(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => void adjust()} disabled={busy}>
                  Post the correction
                </button>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="empty">Nothing on this card yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th>Note</th>
                    <th className="num">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatWhen(entry.createdAt)}</td>
                      <td>{KIND_LABEL[entry.kind]}</td>
                      <td>{entry.narration ?? '—'}</td>
                      <td className="num">
                        {entry.points > 0 ? `+${entry.points}` : entry.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
