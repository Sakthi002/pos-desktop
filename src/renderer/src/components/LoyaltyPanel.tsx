import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from './Field';
import { formatPaise } from '@shared/money';
import { TIER_LABELS, type LoyaltyCard } from '@shared/loyalty';
import type { AppSettings } from '@shared/settings';

const formatDate = (iso: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * Points, as the shop sets them.
 *
 * Two rates, because they answer different questions: what a rupee earns, and
 * what a point is worth coming back. A card keeps the earning rate it was
 * issued with, so raising the rate here rewards new cards rather than silently
 * rewriting what an old one promised.
 */
export function LoyaltyPanel({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (next: AppSettings) => void;
}) {
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = settings.loyalty;

  const load = useCallback(async () => {
    try {
      setCards(await call('loyalty:cards'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function patch(next: Partial<AppSettings['loyalty']>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await call('settings:update', { loyalty: next }));
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const owed = cards.reduce((a, c) => a + c.balancePoints, 0);

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

      <section className="panel-card" style={{ marginBottom: 16 }}>
        <header>
          <Star size={16} />
          <h2>Points</h2>
        </header>
        <div style={{ padding: '16px 20px' }}>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.enabled}
              disabled={busy}
              onChange={(e) => void patch({ enabled: e.target.checked })}
            />
            <span>
              Run a points scheme
              <em>Cards are issued to named customers from the Customers screen.</em>
            </span>
          </label>

          {rules.enabled && (
            <>
              <div className="row">
                <Field
                  label="Points per ₹100 spent"
                  htmlFor="l-earn"
                  hint="Counted on the bill before tax, after discounts"
                  plainLabel
                >
                  <input
                    id="l-earn"
                    type="number"
                    min={0}
                    max={1000}
                    defaultValue={rules.pointsPerHundred}
                    onBlur={(e) => void patch({ pointsPerHundred: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field
                  label="One point is worth"
                  htmlFor="l-value"
                  hint={`Currently ${formatPaise(rules.paisePerPoint)}`}
                  plainLabel
                >
                  <input
                    id="l-value"
                    type="number"
                    min={1}
                    max={10000}
                    defaultValue={rules.paisePerPoint}
                    onBlur={(e) => void patch({ paisePerPoint: Number(e.target.value) || 1 })}
                  />
                </Field>
              </div>

              <div className="row">
                <Field label="Fewest points that may be redeemed" htmlFor="l-min" plainLabel>
                  <input
                    id="l-min"
                    type="number"
                    min={0}
                    defaultValue={rules.minimumRedeemPoints}
                    onBlur={(e) => void patch({ minimumRedeemPoints: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field
                  label="Most of a bill points may pay for"
                  htmlFor="l-cap"
                  hint="Per cent"
                  plainLabel
                >
                  <input
                    id="l-cap"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={rules.maxRedeemPercent}
                    onBlur={(e) => void patch({ maxRedeemPercent: Number(e.target.value) || 1 })}
                  />
                </Field>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={rules.showOnReceipt}
                  disabled={busy}
                  onChange={(e) => void patch({ showOnReceipt: e.target.checked })}
                />
                <span>
                  Print points on the receipt
                  <em>Points used, points earned and the balance after the bill.</em>
                </span>
              </label>
            </>
          )}
        </div>
      </section>

      {rules.enabled && (
        <section className="panel-card">
          <header>
            <h2>Cards</h2>
            <span className="badge" style={{ marginLeft: 'auto' }}>
              {owed} points owed · {formatPaise(owed * rules.paisePerPoint)}
            </span>
          </header>
          {cards.length === 0 ? (
            <p className="empty">
              No cards yet. Issue one to a named customer from the Customers screen.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Customer</th>
                    <th>Tier</th>
                    <th className="num">Points</th>
                    <th className="num">Worth</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => (
                    <tr key={card.id} className={card.isUsable ? '' : 'muted-row'}>
                      <td className="mono">{card.cardNumber}</td>
                      <td>
                        <strong>{card.customerName}</strong>
                        {!card.isUsable && <span className="pill">Not usable</span>}
                      </td>
                      <td>{TIER_LABELS[card.tier]}</td>
                      <td className="num">{card.balancePoints}</td>
                      <td className="num">{formatPaise(card.balancePaise)}</td>
                      <td>{formatDate(card.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
