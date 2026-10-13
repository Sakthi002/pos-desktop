import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise, parseRupees } from '@shared/money';
import { parseQuantity, precisionFor } from '@shared/quantity';
import type { Product } from '@shared/catalogue';
import {
  SUPPLIER_PAYMENT_METHODS,
  type PurchaseReceipt,
  type Supplier,
  type SupplierPaymentMethod,
} from '@shared/purchasing';

interface EntryLine {
  product: Product;
  quantity: string;
  cost: string;
  mrp: string;
  discount: string;
  updateSellingPrice: boolean;
}

const toPaise = (value: string): number => parseRupees(value) ?? 0;

/**
 * Entering a supplier's bill.
 *
 * Deliberately the same shape as the till: find a product, set a quantity, see
 * the total build. The differences are the ones that matter when buying —
 * cost rather than price, the MRP printed on the pack, and tax that is usually
 * added on top rather than already inside.
 */
export function PurchaseEntry({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (purchase: PurchaseReceipt) => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxMode, setTaxMode] = useState<'inclusive' | 'exclusive'>('exclusive');
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [billDiscount, setBillDiscount] = useState('');
  const [notes, setNotes] = useState('');

  const [payNow, setPayNow] = useState(false);
  const [payMethod, setPayMethod] = useState<SupplierPaymentMethod>('cash');
  const [payAmount, setPayAmount] = useState('');

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idempotencyKey = useRef(crypto.randomUUID());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void call('suppliers:list', { status: 'active', pageSize: 200 })
      .then((page) => setSuppliers(page.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (term === '') return;
    let cancelled = false;
    void call('products:search', { search: term, status: 'active', pageSize: 10 })
      .then((page) => {
        if (!cancelled) setResults(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [search]);

  function addProduct(product: Product) {
    setLines((current) =>
      current.some((l) => l.product.id === product.id)
        ? current
        : [
            ...current,
            {
              product,
              quantity: '1',
              cost: (product.costPaise / 100).toFixed(2),
              mrp: product.mrpPaise ? (product.mrpPaise / 100).toFixed(2) : '',
              discount: '',
              updateSellingPrice: false,
            },
          ],
    );
    setSearch('');
    setResults([]);
    searchRef.current?.focus();
  }

  const patch = (id: string, values: Partial<EntryLine>) =>
    setLines((current) => current.map((l) => (l.product.id === id ? { ...l, ...values } : l)));

  /** A local echo of what the service will compute, so the total is live. */
  const totals = useMemo(() => {
    let taxable = 0;
    let tax = 0;
    for (const line of lines) {
      const precision = precisionFor(line.product.unitCode);
      const qty = parseQuantity(line.quantity, precision) ?? 0;
      const net = Math.round((toPaise(line.cost) * qty) / 1000) - toPaise(line.discount);
      if (net <= 0) continue;
      const rate = line.product.taxRateBp;
      if (taxMode === 'inclusive') {
        const base = Math.round((net * 10000) / (10000 + rate));
        taxable += base;
        tax += net - base;
      } else {
        taxable += net;
        tax += Math.round((net * rate) / 10000);
      }
    }
    const discount = toPaise(billDiscount);
    const beforeRounding = Math.max(0, taxable + tax - discount);
    const rounded = Math.round(beforeRounding / 100) * 100;
    return { taxable, tax, total: rounded };
  }, [lines, taxMode, billDiscount]);

  async function save() {
    if (!supplierId) {
      setError('Choose a supplier.');
      return;
    }
    const payload = lines.flatMap((line) => {
      const precision = precisionFor(line.product.unitCode);
      const qty = parseQuantity(line.quantity, precision);
      if (!qty || qty <= 0) return [];
      return [
        {
          productId: line.product.id,
          quantityMilli: qty,
          unitCostPaise: toPaise(line.cost),
          mrpPaise: line.mrp ? toPaise(line.mrp) : null,
          discountPaise: toPaise(line.discount),
          updateSellingPrice: line.updateSellingPrice,
        },
      ];
    });

    if (payload.length === 0) {
      setError('Add at least one item with a quantity.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const purchase = await call('purchases:create', {
        idempotencyKey: idempotencyKey.current,
        supplierId,
        supplierBillNo: billNo.trim() || null,
        purchaseDateIso: new Date(`${billDate}T12:00:00`).toISOString(),
        taxMode,
        lines: payload,
        billDiscountPaise: toPaise(billDiscount),
        notes: notes.trim() || null,
        payment: payNow
          ? { method: payMethod, amountPaise: toPaise(payAmount) || totals.total }
          : null,
      });
      onSaved(purchase);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // A fresh key: the failed attempt wrote nothing, so this is a new bill.
      idempotencyKey.current = crypto.randomUUID();
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New purchase"
      onClose={onClose}
      width={900}
      footer={
        <>
          <span className="field-hint" style={{ marginRight: 'auto' }}>
            Stock goes up when this is saved, and the cost price follows this bill.
          </span>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : `Save · ${formatPaise(totals.total)}`}
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
        <Field label="Supplier" htmlFor="pe-supplier" required>
          <select
            id="pe-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Their bill number" htmlFor="pe-bill">
          <input
            id="pe-bill"
            value={billNo}
            placeholder="As printed on their invoice"
            onChange={(e) => setBillNo(e.target.value)}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="Bill date" htmlFor="pe-date" required>
          <input
            id="pe-date"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
          />
        </Field>
        <Field label="Their prices" htmlFor="pe-mode" required>
          <select
            id="pe-mode"
            value={taxMode}
            onChange={(e) => setTaxMode(e.target.value as 'inclusive' | 'exclusive')}
          >
            <option value="exclusive">GST added on top</option>
            <option value="inclusive">GST already included</option>
          </select>
        </Field>
      </div>

      <div className="pos-search" style={{ marginTop: 6 }}>
        <Search size={17} />
        <input
          ref={searchRef}
          value={search}
          placeholder="Find a product to add"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {results.length > 0 && (
        <ul className="pos-results">
          {results.map((p) => (
            <li key={p.id}>
              <button onClick={() => addProduct(p)}>
                <span className="r-name">
                  {p.name}
                  {p.sku && <em>{p.sku}</em>}
                </span>
                <span className="r-stock">{formatPaise(p.costPaise)} cost</span>
                <span className="r-price">
                  <Plus size={15} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length === 0 ? (
        <p className="empty">Nothing on this bill yet.</p>
      ) : (
        <div className="table-wrap" style={{ margin: '14px 0 0' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Cost</th>
                <th className="num">MRP</th>
                <th className="num">Discount</th>
                <th>Sell at MRP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.product.id}>
                  <td>
                    <strong>{line.product.name}</strong>
                    <span className="sub-cell">
                      {(line.product.taxRateBp / 100).toFixed(0)}% GST · {line.product.unitCode}
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
                      value={line.cost}
                      onChange={(e) => patch(line.product.id, { cost: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="price-input"
                      value={line.mrp}
                      placeholder="—"
                      onChange={(e) => patch(line.product.id, { mrp: e.target.value })}
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
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={line.updateSellingPrice}
                        disabled={!line.mrp}
                        onChange={(e) =>
                          patch(line.product.id, { updateSellingPrice: e.target.checked })
                        }
                      />
                    </label>
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="detail-foot" style={{ marginTop: 18 }}>
        <div>
          <Field label="Bill discount" htmlFor="pe-discount">
            <input
              id="pe-discount"
              className="price-input"
              inputMode="decimal"
              placeholder="0.00"
              value={billDiscount}
              onChange={(e) => setBillDiscount(e.target.value)}
            />
          </Field>
          <Field label="Notes" htmlFor="pe-notes">
            <input id="pe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <label className="check" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={payNow}
              onChange={(e) => {
                setPayNow(e.target.checked);
                if (e.target.checked && !payAmount) {
                  setPayAmount((totals.total / 100).toFixed(2));
                }
              }}
            />
            <span>Paid now</span>
          </label>

          {payNow && (
            <div className="row" style={{ marginTop: 12 }}>
              <Field label="Amount" htmlFor="pe-paid">
                <input
                  id="pe-paid"
                  className="price-input"
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </Field>
              <Field label="Method" htmlFor="pe-method">
                <select
                  id="pe-method"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as SupplierPaymentMethod)}
                >
                  {SUPPLIER_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>

        <div className="totals">
          <div className="t-row">
            <span>Taxable</span>
            <span>{formatPaise(totals.taxable)}</span>
          </div>
          <div className="t-row">
            <span>GST</span>
            <span>{formatPaise(totals.tax)}</span>
          </div>
          {billDiscount && (
            <div className="t-row">
              <span>Bill discount</span>
              <span>−{formatPaise(toPaise(billDiscount))}</span>
            </div>
          )}
          <div className="t-row grand">
            <span>Total</span>
            <span>{formatPaise(totals.total)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
