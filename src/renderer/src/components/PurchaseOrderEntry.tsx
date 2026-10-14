import { useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import type { Product } from '@shared/catalogue';
import type { Supplier } from '@shared/purchasing';
import type { PurchaseOrder } from '@shared/purchase-orders';

interface EntryLine {
  product: Product;
  quantity: string;
  cost: string;
}

/**
 * Ordering goods.
 *
 * The same shape as entering a supplier's bill — find a product, say how many
 * and at what cost — minus everything that only happens when the goods come:
 * no tax, no batches, no payment. Those belong to the bill.
 */
export function PurchaseOrderEntry({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (order: PurchaseOrder) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDays, setExpectedDays] = useState('7');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void call('suppliers:list', { search: '', status: 'active', page: 1, pageSize: 200 })
      .then((page) => {
        setSuppliers(page.items);
        setSupplierId((current) => current || (page.items[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, []);

  const term = search.trim();

  useEffect(() => {
    if (term === '') return;
    let cancelled = false;
    void call('products:search', { search: term, status: 'active', pageSize: 10 })
      .then((page) => {
        if (!cancelled) setResults(page.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [term]);

  const shown = term === '' ? [] : results;

  const add = (product: Product) => {
    setLines((current) =>
      current.some((l) => l.product.id === product.id)
        ? current
        : [
            ...current,
            {
              product,
              quantity: '1',
              // What it cost last time is the best guess at what it will cost
              // this time, and the one figure a shop is most likely to keep.
              cost: (product.costPaise / 100).toFixed(2),
            },
          ],
    );
    setSearch('');
  };

  const patch = (productId: string, change: Partial<EntryLine>) =>
    setLines((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, ...change } : line)),
    );

  const remove = (productId: string) =>
    setLines((current) => current.filter((line) => line.product.id !== productId));

  const lineTotal = (line: EntryLine): number => {
    const quantity = parseQuantity(line.quantity, precisionFor(line.product.unitCode)) ?? 0;
    const cost = parseRupees(line.cost) ?? 0;
    return Math.round((quantity * cost) / 1000);
  };

  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const ready = supplierId !== '' && lines.some((line) => lineTotal(line) >= 0 && line.quantity);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const order = await call('purchaseOrders:create', {
        idempotencyKey,
        supplierId,
        lines: lines.flatMap((line) => {
          const quantity = parseQuantity(line.quantity, precisionFor(line.product.unitCode));
          if (!quantity || quantity <= 0) return [];
          return [
            {
              productId: line.product.id,
              quantityMilli: quantity,
              unitCostPaise: parseRupees(line.cost) ?? 0,
            },
          ];
        }),
        expectedDays: expectedDays.trim() === '' ? null : Number(expectedDays),
        notes: notes.trim() || null,
      });
      onSaved(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New purchase order"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            An order moves no stock and owes nothing.
          </span>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy || !ready}>
            {busy ? 'Saving…' : `Save · ${formatPaise(total)}`}
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
        <Field label="Supplier" htmlFor="po-supplier" required>
          <select
            id="po-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Wanted within" htmlFor="po-days" hint="Days. Blank gives no date">
          <input
            id="po-days"
            type="number"
            min={1}
            max={365}
            value={expectedDays}
            onChange={(e) => setExpectedDays(e.target.value)}
          />
        </Field>
      </div>

      <div className="pos-search">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a product to order"
        />
      </div>

      {shown.length > 0 && (
        <ul className="pos-results">
          {shown.map((product) => (
            <li key={product.id}>
              <button onClick={() => add(product)}>
                <span className="r-name">
                  {product.name}
                  {product.sku && <em>{product.sku}</em>}
                </span>
                <span className="r-stock">
                  {formatQuantity(product.stockMilli, precisionFor(product.unitCode))}{' '}
                  {product.unitCode} in stock
                </span>
                <span className="r-price">{formatPaise(product.costPaise)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length === 0 ? (
        <p className="empty">
          <Plus size={16} /> Nothing ordered yet.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Quantity</th>
                <th className="num">Cost</th>
                <th className="num">Amount</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.product.id}>
                  <td>
                    <strong>{line.product.name}</strong>
                    <span className="sub-cell">
                      {formatQuantity(line.product.stockMilli, precisionFor(line.product.unitCode))}{' '}
                      {line.product.unitCode} in stock
                    </span>
                  </td>
                  <td className="num">
                    <input
                      className="price-input"
                      value={line.quantity}
                      aria-label={`Quantity of ${line.product.name}`}
                      onChange={(e) => patch(line.product.id, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="price-input"
                      value={line.cost}
                      aria-label={`Cost of ${line.product.name}`}
                      onChange={(e) => patch(line.product.id, { cost: e.target.value })}
                    />
                  </td>
                  <td className="num">{formatPaise(lineTotal(line))}</td>
                  <td className="actions">
                    <button
                      className="icon-btn danger"
                      title="Remove"
                      onClick={() => remove(line.product.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Field label="Note for the supplier" htmlFor="po-notes" plainLabel>
        <input
          id="po-notes"
          value={notes}
          placeholder="Send with the Friday lorry"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <div className="totals">
        <div className="t-row grand">
          <span>Order value</span>
          <span>{formatPaise(total)}</span>
        </div>
      </div>
    </Modal>
  );
}
