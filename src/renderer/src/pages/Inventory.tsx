import { useCallback, useEffect, useState } from 'react';
import { Search, Boxes, History, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { call } from '../lib/ipc';
import type { Batch } from '@shared/batches';
import { MovementHistory } from '../components/MovementHistory';
import { StockAdjustDialog } from '../components/StockAdjustDialog';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { formatPaise } from '@shared/money';
import type { Product } from '@shared/catalogue';
import type { LowStockItem } from '@shared/inventory';

type Tab = 'all' | 'low-stock' | 'batches';

/**
 * Stock as the ledger sees it. Nothing here edits a balance directly — an
 * adjustment writes a movement with a reason, and the history explains every
 * number on the screen.
 */
export function Inventory() {
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [low, setLow] = useState<LowStockItem[]>([]);

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, lowStock] = await Promise.all([
        call('products:search', {
          search,
          status: tab === 'low-stock' ? 'low-stock' : 'active',
          sort: 'stock',
          direction: 'asc',
          page,
          pageSize,
        }),
        call('inventory:lowStock'),
      ]);
      setBatches(tab === 'batches' ? await call('batches:list', { inStockOnly: true }) : []);
      // Service items have no stock to show, so they stay out of this screen.
      setItems(result.items.filter((p) => p.trackInventory));
      setTotal(result.total);
      setLow(lowStock);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, tab, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const stockValue = items.reduce((a, p) => a + (p.costPaise * p.stockMilli) / 1000, 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="sub">
            {total} tracked {total === 1 ? 'product' : 'products'} · about{' '}
            {formatPaise(Math.round(stockValue))} on this page at cost
          </p>
        </div>
      </header>

      {low.length > 0 && tab !== 'low-stock' && (
        <div className="low-alert" role="status">
          <AlertTriangle size={16} />
          <span>
            <strong>
              {low.length} {low.length === 1 ? 'item is' : 'items are'} at or below the reorder
              level
            </strong>
            {' — '}
            {low
              .slice(0, 3)
              .map((p) => `${p.name} (${formatQuantity(p.stockMilli, precisionFor(p.unitCode))})`)
              .join(', ')}
            {low.length > 3 ? ' and more' : ''}
          </span>
          <button
            className="btn-secondary"
            onClick={() => {
              setTab('low-stock');
              setPage(1);
            }}
          >
            Show them
          </button>
        </div>
      )}

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

        <div className="tabs inline">
          {(
            [
              { id: 'all', label: 'All stock' },
              { id: 'low-stock', label: `Low stock${low.length ? ` (${low.length})` : ''}` },
              { id: 'batches', label: 'Batches' },
            ] as { id: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab on' : 'tab'}
              onClick={() => {
                setTab(t.id);
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
      ) : tab === 'batches' ? (
        batches.length === 0 ? (
          <div className="empty-state">
            <Boxes size={34} />
            <h2>No batches in stock</h2>
            <p>
              Turn on “keep batches” for a product, and the batch number and expiry are asked for
              when its stock arrives on a supplier’s bill.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Expires</th>
                  <th className="num">Days left</th>
                  <th className="num">In stock</th>
                  <th className="num">At cost</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const precision = precisionFor(b.unitCode);
                  const soon = b.daysToExpiry !== null && b.daysToExpiry <= 30;
                  return (
                    <tr key={b.id} className={b.isExpired ? 'muted-row' : ''}>
                      <td>
                        <strong>{b.productName}</strong>
                        {b.isExpired && <span className="pill danger">Expired</span>}
                      </td>
                      <td className="mono">{b.batchNumber}</td>
                      <td>{b.expiresOn ?? '—'}</td>
                      <td className="num">
                        <span className={soon ? 'stock low' : 'stock'}>
                          {b.daysToExpiry === null ? '—' : b.daysToExpiry}
                        </span>
                      </td>
                      <td className="num">
                        {formatQuantity(b.balanceMilli, precision)} {b.unitCode}
                      </td>
                      <td className="num">
                        {formatPaise(Math.round((b.balanceMilli * b.costPaise) / 1000))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Boxes size={34} />
          <h2>{tab === 'low-stock' ? 'Nothing is running low' : 'No tracked products'}</h2>
          <p>
            {tab === 'low-stock'
              ? 'Every product with a reorder level is above it.'
              : 'Products with stock tracking turned on appear here.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className="num">In stock</th>
                  <th className="num">Reorder at</th>
                  <th className="num">Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const precision = precisionFor(p.unitCode);
                  const isLow = p.reorderLevelMilli > 0 && p.stockMilli <= p.reorderLevelMilli;
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        {isLow && <span className="pill warn">Low</span>}
                        {p.categoryName && <span className="sub-cell">{p.categoryName}</span>}
                      </td>
                      <td className="mono">{p.sku ?? '—'}</td>
                      <td className="num">
                        <span className={isLow ? 'stock low' : 'stock'}>
                          {formatQuantity(p.stockMilli, precision)} {p.unitCode}
                        </span>
                      </td>
                      <td className="num">
                        {p.reorderLevelMilli > 0
                          ? `${formatQuantity(p.reorderLevelMilli, precision)} ${p.unitCode}`
                          : '—'}
                      </td>
                      <td className="num">{formatPaise(p.costPaise)}</td>
                      <td className="actions">
                        <button
                          className="icon-btn"
                          title="Stock history"
                          onClick={() => setHistory(p.id)}
                        >
                          <History size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Adjust stock"
                          onClick={() => setAdjusting(p)}
                        >
                          <SlidersHorizontal size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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

      {history && <MovementHistory productId={history} onClose={() => setHistory(null)} />}

      {adjusting && (
        <StockAdjustDialog
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onAdjusted={() => {
            setAdjusting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
