import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from './Field';
import { formatPaise, parseRupees } from '@shared/money';
import type { Shift } from '@shared/trade';

const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The drawer.
 *
 * A shift is opened with the float that was put in and closed with what was
 * counted out. The expected figure is computed from the session's own cash
 * movements, and the difference is shown rather than hidden — a variance is
 * the reason for counting at all.
 */
export function ShiftPanel() {
  const [current, setCurrent] = useState<Shift | null>(null);
  const [recent, setRecent] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const [open, list] = await Promise.all([call('shift:current'), call('shift:recent')]);
      setCurrent(open);
      setRecent(list.filter((s) => s.closedAt !== null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      await call('shift:open', { openingFloatPaise: parseRupees(float) ?? 0 });
      setFloat('');
      setMessage('Shift opened.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const paise = parseRupees(counted);
    if (paise === null) {
      setError('Count the drawer first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const closed = await call('shift:close', {
        id: current!.id,
        countedPaise: paise,
        notes: notes.trim() || null,
      });
      setCounted('');
      setNotes('');
      setMessage(
        closed.variancePaise === 0
          ? 'Closed, and the drawer agreed to the paisa.'
          : `Closed with a difference of ${formatPaise(Math.abs(closed.variancePaise ?? 0))}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
          <Clock size={16} />
          <h2>{current ? 'The drawer now' : 'No shift open'}</h2>
          {current && (
            <span className="badge ok" style={{ marginLeft: 'auto' }}>
              Opened {formatWhen(current.openedAt)}
              {current.openedByName ? ` by ${current.openedByName}` : ''}
            </span>
          )}
        </header>

        <div style={{ padding: '16px 20px' }}>
          {!current ? (
            <>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Opening a shift records the float put into the drawer, and every sale after it is
                counted against that drawer. A shop that does not count its drawer can leave this
                alone and sell as usual.
              </p>
              <div className="row">
                <Field label="Float put in" htmlFor="sh-float" plainLabel>
                  <input
                    id="sh-float"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={float}
                    onChange={(e) => setFloat(e.target.value)}
                  />
                </Field>
                <div style={{ alignSelf: 'end', paddingBottom: 18 }}>
                  <button className="btn-primary" onClick={() => void open()} disabled={busy}>
                    Open the drawer
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="dash-row" style={{ marginBottom: 16 }}>
                <div className="stat">
                  <span className="stat-label">Should be in the drawer</span>
                  <strong className="stat-value">
                    {formatPaise(current.takings.expectedPaise)}
                  </strong>
                  <span className="stat-note">
                    Float {formatPaise(current.openingFloatPaise)} + cash{' '}
                    {formatPaise(current.takings.cashInPaise)}
                    {current.takings.cashRefundedPaise > 0 &&
                      ` − refunds ${formatPaise(current.takings.cashRefundedPaise)}`}
                    {current.takings.cashPaidOutPaise > 0 &&
                      ` − paid out ${formatPaise(current.takings.cashPaidOutPaise)}`}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Bills</span>
                  <strong className="stat-value">{current.takings.invoices}</strong>
                  <span className="stat-note">
                    Card {formatPaise(current.takings.cardPaise)} · UPI{' '}
                    {formatPaise(current.takings.upiPaise)}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">On account</span>
                  <strong className="stat-value">{formatPaise(current.takings.creditPaise)}</strong>
                  <span className="stat-note">Not in the drawer</span>
                </div>
              </div>

              <div className="row">
                <Field label="Counted out" htmlFor="sh-counted" plainLabel>
                  <input
                    id="sh-counted"
                    className="price-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                  />
                </Field>
                <Field label="Note" htmlFor="sh-notes" plainLabel>
                  <input id="sh-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>

              {counted !== '' && parseRupees(counted) !== null && (
                <p className="field-hint" style={{ marginTop: -4 }}>
                  Difference:{' '}
                  <strong>
                    {formatPaise((parseRupees(counted) ?? 0) - current.takings.expectedPaise)}
                  </strong>
                </p>
              )}

              <button className="btn-primary" onClick={() => void close()} disabled={busy}>
                Close the shift
              </button>
            </>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="panel-card">
          <header>
            <h2>Closed shifts</h2>
          </header>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th className="num">Bills</th>
                  <th className="num">Expected</th>
                  <th className="num">Counted</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((shift) => (
                  <tr key={shift.id}>
                    <td>
                      {formatWhen(shift.openedAt)}
                      {shift.openedByName && <span className="sub-cell">{shift.openedByName}</span>}
                    </td>
                    <td>{formatWhen(shift.closedAt)}</td>
                    <td className="num">{shift.takings.invoices}</td>
                    <td className="num">{formatPaise(shift.expectedPaise ?? 0)}</td>
                    <td className="num">{formatPaise(shift.countedPaise ?? 0)}</td>
                    <td className="num">
                      <span className={shift.variancePaise === 0 ? 'stock' : 'stock low'}>
                        {formatPaise(shift.variancePaise ?? 0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
