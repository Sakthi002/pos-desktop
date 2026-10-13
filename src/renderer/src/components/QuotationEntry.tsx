import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import { PRICE_LEVELS, PRICE_LEVEL_LABELS, priceAt, type PriceLevel } from '@shared/trade';
import type { Product } from '@shared/catalogue';
import type { Customer } from '@shared/customer';
import type { Quotation } from '@shared/quotations';
import type { Bill } from '@shared/billing';

interface EntryLine {
  product: Product;
  quantity: string;
  price: string;
  discount: string;
}

/**
 * Quoting a price.
 *
 * The same shape as the till — find a product, set a quantity, watch the total
 * — because it is the same act, minus the money. What it will not do is take
 * payment: a quotation is a promise, and the sale comes later.
 */
export function QuotationEntry({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (quotation: Quotation) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [priceLevel, setPriceLevel] = useState<PriceLevel>('retail');
  const [validDays, setValidDays] = useState('7');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [priced, setPriced] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    void call('customers:search', { term: '' })
      .then((list) => setCustomers(list.filter((c) => !c.isWalkIn)))
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
        // A search that fails silently looks like a shop with no products.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [term]);

  // An empty box shows nothing, worked out while rendering rather than by
  // clearing state in an effect — the last answer is kept for the next letter.
  const shown = term === '' ? [] : results;

  const payload = useMemo(
    () =>
      lines.flatMap((line) => {
        const qty = parseQuantity(line.quantity, precisionFor(line.product.unitCode));
        if (!qty || qty <= 0) return [];
        return [
          {
            productId: line.product.id,
            quantityMilli: qty,
            unitPricePaise: parseRupees(line.price) ?? 0,
            discountPaise: parseRupees(line.discount) ?? 0,
          },
        ];
      }),
    [lines],
  );

  // Priced by the main process, so a quotation and the bill that follows it
  // are worked out by the same arithmetic.
  useEffect(() => {
    if (payload.length === 0) return;
    let cancelled = false;
    void call('sales:preview', {
      customerId: customerId || null,
      lines: payload,
      cartDiscountPaise: parseRupees(discount) ?? 0,
      redeemPoints: 0,
      priceLevel,
    })
      .then((result) => {
        if (!cancelled) setPriced(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [payload, customerId, discount, priceLevel]);

  // Nothing quoted means no total, derived rather than stored, so an emptied
  // list never shows the price of what used to be in it.
  const bill = payload.length === 0 ? null : priced;

  const add = (product: Product) => {
    setLines((current) =>
      current.some((l) => l.product.id === product.id)
        ? current
        : [
            ...current,
            {
              product,
              quantity: '1',
              price: (priceAt(priceLevel, product) / 100).toFixed(2),
              discount: '',
            },
          ],
    );
    setSearch('');
    setResults([]);
  };

  const patch = (productId: string, change: Partial<EntryLine>) =>
    setLines((current) =>
      current.map((l) => (l.product.id === productId ? { ...l, ...change } : l)),
    );

  const changeLevel = (level: PriceLevel) => {
    setPriceLevel(level);
    setLines((current) =>
      current.map((l) => ({ ...l, price: (priceAt(level, l.product) / 100).toFixed(2) })),
    );
  };

  async function save() {
    if (payload.length === 0) {
      setError('Add at least one item with a quantity.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const days = Number(validDays);
      onSaved(
        await call('quotations:create', {
          idempotencyKey,
          customerId: customerId || null,
          lines: payload,
          cartDiscountPaise: parseRupees(discount) ?? 0,
          priceLevel,
          validDays: Number.isFinite(days) && days > 0 ? days : null,
          notes: notes.trim() || null,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New quotation"
      onClose={onClose}
      width={880}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            A quotation moves no stock and takes no money.
          </span>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : `Save · ${formatPaise(bill?.totalPaise ?? 0)}`}
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
        <Field label="For" htmlFor="q-customer" hint="Leave blank for a walk-in" plainLabel>
          <select
            id="q-customer"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              const chosen = customers.find((c) => c.id === e.target.value);
              if (chosen) changeLevel(chosen.priceLevel);
            }}
          >
            <option value="">Walk-in customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price list" htmlFor="q-level" plainLabel>
          <select
            id="q-level"
            value={priceLevel}
            onChange={(e) => changeLevel(e.target.value as PriceLevel)}
          >
            {PRICE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {PRICE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="Holds for" htmlFor="q-valid" hint="Days. Blank never expires" plainLabel>
          <input
            id="q-valid"
            type="number"
            min={1}
            max={365}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
          />
        </Field>
        <Field label="Discount on the whole quotation" htmlFor="q-discount" plainLabel>
          <input
            id="q-discount"
            className="price-input"
            inputMode="decimal"
            placeholder="0.00"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
      </div>

      <div className="pos-search" style={{ marginBottom: 12 }}>
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a product to quote"
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
                  {product.unitCode}
                </span>
                <span className="r-price">{formatPaise(priceAt(priceLevel, product))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length === 0 ? (
        <p className="empty">
          <Plus size={16} /> Nothing quoted yet.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Discount</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const priced = bill?.lines.find((b) => b.productId === line.product.id);
                return (
                  <tr key={line.product.id}>
                    <td>
                      <strong>{line.product.name}</strong>
                      <span className="sub-cell">
                        {formatQuantity(
                          line.product.stockMilli,
                          precisionFor(line.product.unitCode),
                        )}{' '}
                        {line.product.unitCode} in stock
                      </span>
                    </td>
                    <td className="num">
                      <input
                        className="price-input"
                        value={line.quantity}
                        onChange={(e) => patch(line.product.id, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="price-input"
                        value={line.price}
                        onChange={(e) => patch(line.product.id, { price: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="price-input"
                        value={line.discount}
                        placeholder="0.00"
                        onChange={(e) => patch(line.product.id, { discount: e.target.value })}
                      />
                    </td>
                    <td className="num">{formatPaise(priced?.totalPaise ?? 0)}</td>
                    <td className="actions">
                      <button
                        className="icon-btn danger"
                        aria-label={`Remove ${line.product.name}`}
                        onClick={() =>
                          setLines((c) => c.filter((l) => l.product.id !== line.product.id))
                        }
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
      )}

      <Field label="Note for the customer" htmlFor="q-notes" plainLabel>
        <input
          id="q-notes"
          value={notes}
          placeholder="Delivery in three days"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {bill && (
        <div className="totals" style={{ marginTop: 6 }}>
          <div className="t-row">
            <span>Value</span>
            <span>{formatPaise(bill.taxablePaise)}</span>
          </div>
          {bill.taxPaise > 0 && (
            <div className="t-row">
              <span>{bill.isInterstate ? 'IGST' : 'CGST + SGST'}</span>
              <span>{formatPaise(bill.taxPaise)}</span>
            </div>
          )}
          <div className="t-row grand">
            <span>Total</span>
            <span>{formatPaise(bill.totalPaise)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
