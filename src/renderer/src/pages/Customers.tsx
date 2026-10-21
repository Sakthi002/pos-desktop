import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Users, Pencil, Receipt, UserX, UserCheck, Star, Wallet } from 'lucide-react';
import { call } from '../lib/ipc';
import { CustomerForm } from '../components/CustomerForm';
import { Pager } from '../components/Pager';
import { PAGE_SIZES } from '../lib/paging';
import { CustomerHistory } from '../components/CustomerHistory';
import { LoyaltyCardDialog } from '../components/LoyaltyCardDialog';
import { CustomerAccountDialog } from '../components/CustomerAccountDialog';
import { formatPaise } from '@shared/money';
import type { Customer, CustomerQuery, CustomerSummary } from '@shared/customer';
import type { AppSettings } from '@shared/settings';

type Status = CustomerQuery['status'];

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' },
];

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function Customers({ settings }: { settings: AppSettings }) {
  const loyaltyOn = settings.loyalty.enabled;
  const [items, setItems] = useState<CustomerSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Customer | null | 'new'>(null);
  const [viewing, setViewing] = useState<CustomerSummary | null>(null);
  const [pointsFor, setPointsFor] = useState<CustomerSummary | null>(null);
  const [accountFor, setAccountFor] = useState<CustomerSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('customers:list', { search, status, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, status, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function toggleActive(customer: CustomerSummary) {
    try {
      await call('customers:setActive', { id: customer.id, isActive: !customer.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="sub">
            {total} {total === 1 ? 'customer' : 'customers'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New customer
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, phone or GSTIN"
          />
        </div>

        <div className="tabs inline">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              className={status === t.id ? 'tab on' : 'tab'}
              onClick={() => {
                setStatus(t.id);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 28px' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Users size={34} />
          <h2>{search ? 'No customers match' : 'No customers yet'}</h2>
          <p>
            {search
              ? 'Try a different search.'
              : 'Named customers are optional — walk-in covers the rest.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>GSTIN</th>
                  <th className="num">Invoices</th>
                  <th className="num">Spent</th>
                  <th className="num">Owes</th>
                  <th>Last purchase</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={c.isActive ? '' : 'muted-row'}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.isWalkIn && <span className="pill">Walk-in</span>}
                      {!c.isActive && <span className="pill">Inactive</span>}
                      {c.address && <span className="sub-cell">{c.address}</span>}
                    </td>
                    <td>{c.phone ?? '—'}</td>
                    <td className="mono">{c.gstin ?? '—'}</td>
                    <td className="num">{c.invoices}</td>
                    <td className="num">{formatPaise(c.totalPaise)}</td>
                    {/* Derived, never stored: billed on credit, less credit
                        notes, less what has been received. A customer who has
                        paid ahead is owed, not owing. */}
                    <td className="num">
                      {c.outstandingPaise > 0 ? (
                        <strong className="owes">{formatPaise(c.outstandingPaise)}</strong>
                      ) : c.outstandingPaise < 0 ? (
                        <span className="in-advance" title="Paid in advance">
                          +{formatPaise(-c.outstandingPaise)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatDate(c.lastPurchaseAt)}</td>
                    <td className="actions">
                      <button
                        className="icon-btn"
                        title="Purchase history"
                        onClick={() => setViewing(c)}
                      >
                        <Receipt size={15} />
                      </button>
                      {!c.isWalkIn && (
                        <button
                          className="icon-btn view"
                          title="Account"
                          onClick={() => setAccountFor(c)}
                        >
                          <Wallet size={15} />
                        </button>
                      )}
                      {loyaltyOn && !c.isWalkIn && (
                        <button
                          className="icon-btn print"
                          title="Points"
                          onClick={() => setPointsFor(c)}
                        >
                          <Star size={15} />
                        </button>
                      )}
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(c)}>
                        <Pencil size={15} />
                      </button>
                      {!c.isWalkIn && (
                        <button
                          className={c.isActive ? 'icon-btn danger' : 'icon-btn'}
                          title={c.isActive ? 'Deactivate' : 'Reactivate'}
                          onClick={() => void toggleActive(c)}
                        >
                          {c.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}

      {editing !== null && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {viewing && <CustomerHistory customer={viewing} onClose={() => setViewing(null)} />}

      {accountFor && (
        <CustomerAccountDialog
          customer={accountFor}
          onClose={() => {
            setAccountFor(null);
            void load();
          }}
        />
      )}

      {pointsFor && (
        <LoyaltyCardDialog
          customer={pointsFor}
          onClose={() => {
            setPointsFor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
