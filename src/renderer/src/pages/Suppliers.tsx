import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Truck, Pencil, Wallet, UserX, UserCheck, BookOpen } from 'lucide-react';
import { call } from '../lib/ipc';
import { SupplierForm } from '../components/SupplierForm';
import { PaySupplierDialog } from '../components/PaySupplierDialog';
import { PartyLedgerDialog } from '../components/PartyLedgerDialog';
import { formatPaise } from '@shared/money';
import type { Supplier, SupplierQuery, SupplierSummary } from '@shared/purchasing';

type Status = SupplierQuery['status'];

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

export function Suppliers() {
  const [items, setItems] = useState<SupplierSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Supplier | null | 'new'>(null);
  const [paying, setPaying] = useState<SupplierSummary | null>(null);
  const [ledgerFor, setLedgerFor] = useState<SupplierSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('suppliers:list', { search, status, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  async function toggleActive(supplier: SupplierSummary) {
    try {
      await call('suppliers:setActive', { id: supplier.id, isActive: !supplier.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const owed = items.reduce((a, s) => a + Math.max(0, s.outstandingPaise), 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p className="sub">
            {total} {total === 1 ? 'supplier' : 'suppliers'}
            {owed > 0 && ` · ${formatPaise(owed)} owed on this page`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New supplier
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
          <Truck size={34} />
          <h2>{search ? 'No suppliers match' : 'No suppliers yet'}</h2>
          <p>
            {search
              ? 'Try a different search.'
              : 'Add the people you buy from, then record purchases against them.'}
          </p>
          {!search && (
            <div className="page-actions">
              <button className="btn-primary" onClick={() => setEditing('new')}>
                <Plus size={16} /> New supplier
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Phone</th>
                  <th>GSTIN</th>
                  <th className="num">Bills</th>
                  <th className="num">Purchased</th>
                  <th className="num">Owed</th>
                  <th>Last purchase</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={s.isActive ? '' : 'muted-row'}>
                    <td>
                      <strong>{s.name}</strong>
                      {!s.isActive && <span className="pill">Inactive</span>}
                      {s.city && <span className="sub-cell">{s.city}</span>}
                    </td>
                    <td>{s.phone ?? '—'}</td>
                    <td className="mono">{s.gstin ?? '—'}</td>
                    <td className="num">{s.purchases}</td>
                    <td className="num">{formatPaise(s.purchasedPaise)}</td>
                    <td className="num">
                      {s.outstandingPaise > 0 ? (
                        <strong className="stock low">{formatPaise(s.outstandingPaise)}</strong>
                      ) : s.outstandingPaise < 0 ? (
                        <span className="sub-cell">
                          {formatPaise(-s.outstandingPaise)} in credit
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatDate(s.lastPurchaseAt)}</td>
                    <td className="actions">
                      <button
                        className="icon-btn print"
                        title="Record a payment"
                        onClick={() => setPaying(s)}
                      >
                        <Wallet size={15} />
                      </button>
                      <button
                        className="icon-btn view"
                        title="Account"
                        onClick={() => setLedgerFor(s)}
                      >
                        <BookOpen size={15} />
                      </button>
                      <button className="icon-btn view" title="Edit" onClick={() => setEditing(s)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        className={s.isActive ? 'icon-btn danger' : 'icon-btn'}
                        title={s.isActive ? 'Deactivate' : 'Reactivate'}
                        onClick={() => void toggleActive(s)}
                      >
                        {s.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="pager">
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {editing !== null && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {ledgerFor && (
        <PartyLedgerDialog
          partyType="supplier"
          partyId={ledgerFor.id}
          name={ledgerFor.name}
          onClose={() => setLedgerFor(null)}
        />
      )}

      {paying && (
        <PaySupplierDialog
          supplier={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
