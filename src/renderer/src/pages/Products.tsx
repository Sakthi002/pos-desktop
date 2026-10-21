import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Upload,
  Download,
  Package,
  Pencil,
  Trash2,
  ArrowUpDown,
  Tag,
} from 'lucide-react';
import { call } from '../lib/ipc';
import { ProductForm } from '../components/ProductForm';
import { Pager } from '../components/Pager';
import { PAGE_SIZES } from '../lib/paging';
import { CsvImportDialog } from '../components/CsvImportDialog';
import { LabelDialog } from '../components/LabelDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  UNCATEGORISED,
  type Category,
  type Product,
  type ProductQuery,
  type Unit,
} from '@shared/catalogue';
import { formatPaise } from '@shared/money';
import { formatQuantity, precisionFor } from '@shared/quantity';
import type { AppSettings } from '@shared/settings';

type Status = ProductQuery['status'];
type Sort = ProductQuery['sort'];

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'low-stock', label: 'Low stock' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' },
];

export function Products({ settings }: { settings: AppSettings }) {
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [importing, setImporting] = useState(false);
  const [labelling, setLabelling] = useState(false);

  const [removing, setRemoving] = useState<Product | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call('products:search', {
        search,
        status,
        categoryId: categoryId || null,
        sort,
        direction,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, status, categoryId, sort, direction, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([call('catalogue:listUnits'), call('catalogue:listCategories')])
      .then(([u, c]) => {
        setUnits(u);
        setCategories(c);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function toggleSort(column: Sort) {
    if (sort === column) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(column);
      setDirection('asc');
    }
    setPage(1);
  }

  async function exportCsv() {
    try {
      const csv = await call('products:exportCsv');
      await call('dialog:saveCsv', {
        suggestedName: `products-${new Date().toISOString().slice(0, 10)}.csv`,
        content: csv,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await call('products:remove', { id: removing.id });
      setRemoving(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoveBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Products</h1>
          <p className="sub">
            {total} {total === 1 ? 'product' : 'products'}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn-info"
            onClick={() => setLabelling(true)}
            disabled={items.length === 0}
          >
            <Tag size={15} /> Labels
          </button>
          <button className="btn-info" onClick={() => setImporting(true)}>
            <Upload size={15} /> Import
          </button>
          <button className="btn-info" onClick={() => void exportCsv()} disabled={total === 0}>
            <Download size={15} /> Export
          </button>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New product
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
            placeholder="Search name, SKU or barcode"
          />
        </div>

        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {/* Filing is optional, so this is how a shop finds what it skipped. */}
          <option value={UNCATEGORISED}>No category</option>
        </select>

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
          <Package size={34} />
          <h2>{search || categoryId ? 'No products match' : 'No products yet'}</h2>
          <p>
            {search || categoryId
              ? 'Try a different search or filter.'
              : 'Add your first product, or import a catalogue from CSV.'}
          </p>
          {!search && !categoryId && (
            <div className="page-actions">
              <button className="btn-secondary" onClick={() => setImporting(true)}>
                <Upload size={15} /> Import CSV
              </button>
              <button className="btn-primary" onClick={() => setEditing('new')}>
                <Plus size={16} /> New product
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
                  <th className="sortable" onClick={() => toggleSort('name')}>
                    Product <ArrowUpDown size={12} />
                  </th>
                  <th className="sortable" onClick={() => toggleSort('sku')}>
                    SKU <ArrowUpDown size={12} />
                  </th>
                  <th>Category</th>
                  <th className="num sortable" onClick={() => toggleSort('price')}>
                    Price <ArrowUpDown size={12} />
                  </th>
                  <th className="num">GST</th>
                  <th className="num sortable" onClick={() => toggleSort('stock')}>
                    Stock <ArrowUpDown size={12} />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const precision = precisionFor(p.unitCode);
                  const low =
                    p.trackInventory &&
                    p.reorderLevelMilli > 0 &&
                    p.stockMilli <= p.reorderLevelMilli;
                  return (
                    <tr key={p.id} className={p.isActive ? '' : 'muted-row'}>
                      <td>
                        <strong>{p.name}</strong>
                        {!p.isActive && <span className="pill">Inactive</span>}
                        {p.brand && <span className="sub-cell">{p.brand}</span>}
                      </td>
                      <td className="mono">{p.sku ?? '—'}</td>
                      <td>{p.categoryName ?? '—'}</td>
                      <td className="num">{formatPaise(p.pricePaise)}</td>
                      <td className="num">{(p.taxRateBp / 100).toFixed(0)}%</td>
                      <td className="num">
                        {p.trackInventory ? (
                          <span className={low ? 'stock low' : 'stock'}>
                            {formatQuantity(p.stockMilli, precision)} {p.unitCode}
                          </span>
                        ) : (
                          <span className="sub-cell">Service</span>
                        )}
                      </td>
                      <td className="actions">
                        {/* Stock is changed on the Inventory screen, beside the
                            history that explains every movement. */}
                        <button className="icon-btn" title="Edit" onClick={() => setEditing(p)}>
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Remove"
                          onClick={() => setRemoving(p)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
        <ProductForm
          product={editing === 'new' ? null : editing}
          units={units}
          categories={categories}
          defaultTaxInclusive={settings.tax.mode === 'inclusive'}
          gstRegistered={settings.tax.registered}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {labelling && <LabelDialog products={items} onClose={() => setLabelling(false)} />}

      {importing && (
        <CsvImportDialog
          onClose={() => setImporting(false)}
          onImported={() => {
            void load();
            void call('catalogue:listCategories').then(setCategories);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove product"
          message={
            `Remove "${removing.name}"? If it appears on any past sale or stock movement it will be ` +
            `made inactive instead of deleted, so history stays intact.`
          }
          confirmLabel="Remove"
          destructive
          busy={removeBusy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
