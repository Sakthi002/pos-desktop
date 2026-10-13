import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { hueStyle } from '../lib/hues';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import type { DashboardSummary } from '@shared/dashboard';
import type { Route } from '../components/AppShell';

const pad = (n: number) => String(n).padStart(2, '0');

const startOfToday = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
};

const endOfToday = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
};

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * What the shop looks like on walking in: what today has taken, what is about
 * to run out, and the last few bills. Every figure comes from the same queries
 * the reports use, so the two cannot disagree.
 */
export function Dashboard({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call('dashboard:summary', { fromIso: startOfToday(), toIso: endOfToday() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  const today = data?.today;
  const week = data?.week;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Today</h1>
          <p className="sub">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
      </header>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}

      {!data || !today || !week ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className="dash">
          <section className="dash-row">
            <div className="stat hued" style={hueStyle('indigo')}>
              <span className="stat-chip">
                <Wallet size={17} />
              </span>
              <span className="stat-label">Takings today</span>
              <strong className="stat-value">{formatPaise(today.netPaise)}</strong>
              <span className="stat-note">
                {today.invoices} {today.invoices === 1 ? 'bill' : 'bills'}
                {today.returnedPaise > 0 && ` · ${formatPaise(today.returnedPaise)} returned`}
              </span>
            </div>
            <div className="stat hued" style={hueStyle('teal')}>
              <span className="stat-chip">
                <TrendingUp size={17} />
              </span>
              <span className="stat-label">Last seven days</span>
              <strong className="stat-value">{formatPaise(week.netPaise)}</strong>
              <span className="stat-note">
                {week.invoices} {week.invoices === 1 ? 'bill' : 'bills'}
              </span>
            </div>
            <div className="stat hued" style={hueStyle('violet')}>
              <span className="stat-chip">
                <Receipt size={17} />
              </span>
              <span className="stat-label">Average bill today</span>
              <strong className="stat-value">
                {today.invoices > 0
                  ? formatPaise(Math.round(today.totalPaise / today.invoices))
                  : '—'}
              </strong>
              <span className="stat-note">Before returns</span>
            </div>

            {data.expiring.batches > 0 && (
              <div className="stat hued" style={hueStyle('amber')}>
                <span className="stat-chip">
                  <CalendarClock size={17} />
                </span>
                <span className="stat-label">Expiring within a month</span>
                <strong className="stat-value">{data.expiring.batches}</strong>
                <span className="stat-note">
                  {formatPaise(data.expiring.valuePaise)} at cost · see Inventory → Batches
                </span>
              </div>
            )}
          </section>

          <section className="dash-cols">
            <div className="panel-card">
              <header>
                <h2>In the till today</h2>
              </header>
              {data.methods.length === 0 ? (
                <p className="empty">No payments yet today.</p>
              ) : (
                <ul className="dash-list">
                  {data.methods.map((m) => (
                    <li key={m.method}>
                      <span>{m.method.toUpperCase()}</span>
                      <strong>
                        {formatPaise(m.collectedPaise - m.refundedPaise)}
                        {m.refundedPaise > 0 && (
                          <span className="sub-cell">{formatPaise(m.refundedPaise)} refunded</span>
                        )}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
              <footer>
                <button className="link-btn" onClick={() => onNavigate('reports')}>
                  Reports <ArrowRight size={13} />
                </button>
              </footer>
            </div>

            <div className="panel-card">
              <header>
                <h2>Running low</h2>
                {data.lowStock.length > 0 && (
                  <span className="pill warn">{data.lowStock.length}</span>
                )}
              </header>
              {data.lowStock.length === 0 ? (
                <p className="empty">Nothing below its reorder level.</p>
              ) : (
                <ul className="dash-list">
                  {data.lowStock.map((item) => (
                    <li key={item.id}>
                      <span>
                        {item.name}
                        {item.sku && <span className="sub-cell">{item.sku}</span>}
                      </span>
                      <strong className="stock low">
                        {formatQuantity(item.stockMilli, precisionFor(item.unitCode))}{' '}
                        {item.unitCode}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
              <footer>
                <button className="link-btn" onClick={() => onNavigate('inventory')}>
                  Inventory <ArrowRight size={13} />
                </button>
              </footer>
            </div>
          </section>

          <section className="panel-card">
            <header>
              <h2>Recent bills</h2>
            </header>
            {data.recentSales.length === 0 ? (
              <div className="empty-state" style={{ padding: '28px 0' }}>
                <Receipt size={28} />
                <h2>No sales yet</h2>
                <p>The first bill of the day appears here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Time</th>
                      <th>Customer</th>
                      <th>Payment</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.map((sale) => (
                      <tr key={sale.id} className={sale.status === 'voided' ? 'muted-row' : ''}>
                        <td>
                          <strong className="mono">{sale.invoiceNumber}</strong>
                          {sale.status === 'voided' && <span className="pill danger">Voided</span>}
                        </td>
                        <td>{formatTime(sale.invoiceDate)}</td>
                        <td>{sale.customerName ?? 'Walk-in'}</td>
                        <td>
                          {sale.paymentMethods.map((m) => m.toUpperCase()).join(' + ') || '—'}
                        </td>
                        <td className="num">{formatPaise(sale.totalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer>
              <button className="link-btn" onClick={() => onNavigate('sales')}>
                All sales <ArrowRight size={13} />
              </button>
            </footer>
          </section>

          {data.lowStock.length > 0 && (
            <p className="field-hint" style={{ padding: '0 28px 24px' }}>
              <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Low-stock alerts only appear for products with a reorder level set.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
