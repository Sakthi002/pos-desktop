import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  User,
  PauseCircle,
  PlayCircle,
  ShoppingCart,
  CheckCircle2,
  X,
  Printer,
  Pencil,
  Package,
  LayoutGrid,
  WifiOff,
} from 'lucide-react';
import { call } from '../lib/ipc';
import { PaymentDialog } from '../components/PaymentDialog';
import { ReceiptPreview } from '../components/ReceiptPreview';
import type { Category, Product } from '@shared/catalogue';
import type { Customer } from '@shared/customer';
import type { Bill } from '@shared/billing';
import type { PaymentInput, SaleReceipt } from '@shared/sale';
import { formatPaise, parseRupees } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import type { AppSettings } from '@shared/settings';

interface CartLine {
  product: Product;
  quantityMilli: number;
  unitPricePaise: number;
  discountPaise: number;
}

interface HeldCart {
  id: string;
  label: string;
  lines: CartLine[];
  customer: Customer | null;
  cartDiscountPaise: number;
}

/** Colour a product tile from its name, so the wall of tiles is scannable. */
const TILE_TINTS = [
  { bg: '#E8F4EF', ink: '#0A6349' },
  { bg: '#EEF2FF', ink: '#3730A3' },
  { bg: '#FEF6E7', ink: '#92400E' },
  { bg: '#F3EEFB', ink: '#5B21B6' },
  { bg: '#FDF0EC', ink: '#9A3412' },
] as const;

const tintFor = (id: string) => {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum += id.charCodeAt(i);
  return TILE_TINTS[sum % TILE_TINTS.length] as (typeof TILE_TINTS)[number];
};

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

const clockLabel = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function Pos({ settings }: { settings: AppSettings }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cartDiscount, setCartDiscount] = useState('');
  const [rawBill, setBill] = useState<Bill | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [grid, setGrid] = useState<Product[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const [held, setHeld] = useState<HeldCart[]>([]);
  const [showCustomers, setShowCustomers] = useState(false);
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [paying, setPaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [previewSaleId, setPreviewSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  // Regenerated per checkout attempt, so a retry of the same sale is safe but a
  // genuinely new sale is never mistaken for a duplicate.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  // ─── Loading ──────────────────────────────────────────────────────────────

  useEffect(() => {
    void call('customers:walkIn')
      .then((w) => setCustomer(w))
      .catch(() => undefined);
    void call('catalogue:listCategories')
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  // The tile wall: what the shop sells, so the common items are one tap away
  // instead of something to type.
  useEffect(() => {
    let cancelled = false;
    void call('products:search', {
      status: 'active',
      categoryId: activeCategory || null,
      sort: 'name',
      pageSize: 60,
    })
      .then((page) => {
        if (!cancelled) setGrid(page.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  useEffect(() => {
    const term = search.trim();
    if (term === '') return;

    let cancelled = false;
    void call('products:search', { search: term, status: 'active', pageSize: 20 })
      .then((page) => {
        if (!cancelled) setResults(page.items);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [search]);

  // An empty search box shows nothing: derived, so no state write is needed.
  const visibleResults = search.trim() === '' ? [] : results;

  const previewInput = useMemo(
    () => ({
      customerId: customer?.id ?? null,
      lines: cart.map((l) => ({
        productId: l.product.id,
        quantityMilli: l.quantityMilli,
        unitPricePaise: l.unitPricePaise,
        discountPaise: l.discountPaise,
      })),
      cartDiscountPaise: parseRupees(cartDiscount) ?? 0,
    }),
    [cart, customer, cartDiscount],
  );

  useEffect(() => {
    if (cart.length === 0) return;

    let cancelled = false;
    void call('sales:preview', previewInput)
      .then((b) => {
        if (!cancelled) setBill(b);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [previewInput, cart.length]);

  // Derived rather than stored, so clearing the cart cannot leave a stale total
  // on screen for a frame while the next preview is in flight.
  const bill = cart.length === 0 ? null : rawBill;

  // ─── Cart ─────────────────────────────────────────────────────────────────

  const addProduct = useCallback((product: Product) => {
    setCart((current) => {
      const index = current.findIndex((l) => l.product.id === product.id);
      if (index >= 0) {
        // Same product again: bump the quantity by one unit of its measure.
        return current.map((l, i) =>
          i === index ? { ...l, quantityMilli: l.quantityMilli + 1000 } : l,
        );
      }
      return [
        ...current,
        {
          product,
          quantityMilli: 1000,
          unitPricePaise: product.pricePaise,
          discountPaise: 0,
        },
      ];
    });
    setSearch('');
    setResults([]);
    searchRef.current?.focus();
  }, []);

  /** A barcode scanner types fast and ends with Enter; treat an exact match as a scan. */
  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;

    const exact =
      visibleResults.find((p) => p.barcode === term) ??
      visibleResults.find((p) => p.sku?.toLowerCase() === term.toLowerCase()) ??
      visibleResults[0];
    if (exact) addProduct(exact);
  }

  const setQuantity = (productId: string, milli: number) =>
    setCart((c) =>
      c
        .map((l) => (l.product.id === productId ? { ...l, quantityMilli: Math.max(0, milli) } : l))
        .filter((l) => l.quantityMilli > 0),
    );

  const removeLine = (productId: string) =>
    setCart((c) => c.filter((l) => l.product.id !== productId));

  function clearSale() {
    setCart([]);
    setCartDiscount('');
    setBill(null);
    setError(null);
    setEditing(null);
    idempotencyKey.current = crypto.randomUUID();
    void call('customers:walkIn')
      .then(setCustomer)
      .catch(() => undefined);
  }

  // ─── Hold and resume ──────────────────────────────────────────────────────

  function holdCart() {
    if (cart.length === 0) return;
    setHeld((h) => [
      ...h,
      {
        id: crypto.randomUUID(),
        label: `${cart.length} item${cart.length === 1 ? '' : 's'} · ${formatPaise(bill?.totalPaise ?? 0)}`,
        lines: cart,
        customer,
        cartDiscountPaise: parseRupees(cartDiscount) ?? 0,
      },
    ]);
    clearSale();
  }

  function resumeCart(id: string) {
    const entry = held.find((h) => h.id === id);
    if (!entry) return;
    setCart(entry.lines);
    setCustomer(entry.customer);
    setCartDiscount(entry.cartDiscountPaise ? (entry.cartDiscountPaise / 100).toFixed(2) : '');
    setHeld((h) => h.filter((x) => x.id !== id));
    idempotencyKey.current = crypto.randomUUID();
  }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  async function completeSale(payments: PaymentInput[]) {
    setSaving(true);
    setPayError(null);
    try {
      const result = await call('sales:create', {
        idempotencyKey: idempotencyKey.current,
        customerId: customer?.isWalkIn ? null : (customer?.id ?? null),
        lines: cart.map((l) => ({
          productId: l.product.id,
          quantityMilli: l.quantityMilli,
          unitPricePaise: l.unitPricePaise,
          discountPaise: l.discountPaise,
        })),
        cartDiscountPaise: parseRupees(cartDiscount) ?? 0,
        payments,
      });
      setReceipt(result);
      setPaying(false);
      clearSale();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function openCustomers() {
    setShowCustomers(true);
    try {
      setCustomerList(await call('customers:search', { term: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F4' && cart.length > 0 && bill) {
        e.preventDefault();
        setPaying(true);
      }
      if (e.key === 'F8' && cart.length > 0) {
        e.preventDefault();
        holdCart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const units = cart.reduce((a, l) => a + l.quantityMilli / 1000, 0);

  return (
    <div className="pos">
      <section className="pos-catalogue">
        <div className="pos-topbar">
          <span className="till-chip">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span className="till-chip mono">{clockLabel(new Date())}</span>
          {cart.length > 0 && (
            <span className="till-chip live">
              <span className="dot" /> Bill in progress
            </span>
          )}
          <span className="till-chip ghost">
            <WifiOff size={13} /> Works offline · saved on this computer
          </span>
        </div>

        <div className="pos-browse">
          {/* A rail holding nothing but "All" is only a thinner screen. */}
          {categories.length > 0 && (
            <nav className="cat-rail" aria-label="Categories">
              <button
                className={activeCategory === '' ? 'cat on' : 'cat'}
                onClick={() => setActiveCategory('')}
              >
                <LayoutGrid size={20} />
                <span>All</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={activeCategory === c.id ? 'cat on' : 'cat'}
                  onClick={() => setActiveCategory(c.id)}
                >
                  <Package size={20} />
                  <span>{c.name}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="pos-main">
            <div className="pos-search">
              <Search size={17} />
              <input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Scan a barcode, or type a name"
              />
              <kbd>F2</kbd>
            </div>

            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}

            {visibleResults.length > 0 ? (
              <ul className="pos-results">
                {visibleResults.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => addProduct(p)}>
                      <span className="r-name">
                        {p.name}
                        {p.sku && <em>{p.sku}</em>}
                      </span>
                      <span className="r-stock">
                        {p.trackInventory
                          ? `${formatQuantity(p.stockMilli, precisionFor(p.unitCode))} ${p.unitCode}`
                          : 'Service'}
                      </span>
                      <span className="r-price">{formatPaise(p.pricePaise)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : grid.length === 0 ? (
              <div className="empty-state">
                <Package size={34} />
                <h2>Nothing to sell yet</h2>
                <p>Add products, or import a catalogue from CSV, and they appear here.</p>
              </div>
            ) : (
              <div className="tile-grid">
                {grid.map((p) => {
                  const tint = tintFor(p.id);
                  const precision = precisionFor(p.unitCode);
                  const low =
                    p.trackInventory &&
                    p.reorderLevelMilli > 0 &&
                    p.stockMilli <= p.reorderLevelMilli;
                  return (
                    <button key={p.id} className="tile" onClick={() => addProduct(p)}>
                      <span className="tile-art" style={{ background: tint.bg, color: tint.ink }}>
                        {initialsOf(p.name)}
                        {low && (
                          <span className="tile-low">
                            {formatQuantity(p.stockMilli, precision)} left
                          </span>
                        )}
                      </span>
                      <span className="tile-name">{p.name}</span>
                      {p.sku && <span className="tile-sku mono">{p.sku}</span>}
                      <span className="tile-foot">
                        <span className="tile-price">{formatPaise(p.pricePaise)}</span>
                        <span className="tile-add" aria-hidden="true">
                          <Plus size={17} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="pos-bill">
        <div className="bill-head">
          <button className="customer-btn" onClick={() => void openCustomers()}>
            <span className="avatar">
              <User size={18} />
            </span>
            <span className="who">
              <strong>{customer?.name ?? 'Walk-in Customer'}</strong>
              <span>{customer?.gstin ?? 'No GST details on this bill'}</span>
            </span>
            <span className="change-link">Change</span>
          </button>
        </div>

        <div className="bill-count">
          <span>
            {units % 1 === 0 ? units : units.toFixed(2)} {units === 1 ? 'item' : 'items'}
          </span>
          {cart.length > 0 && (
            <button className="link-btn danger" onClick={clearSale}>
              Clear all
            </button>
          )}
        </div>

        <div className="bill-lines">
          {cart.length === 0 ? (
            <div className="bill-empty">
              <ShoppingCart size={26} />
              <h2>No items yet</h2>
              <p>Scan a barcode or tap a product.</p>
            </div>
          ) : (
            cart.map((l) => {
              const precision = precisionFor(l.product.unitCode);
              const billLine = bill?.lines.find((b) => b.productId === l.product.id);
              const tint = tintFor(l.product.id);
              const open = editing === l.product.id;
              return (
                <div key={l.product.id} className={open ? 'bill-line open' : 'bill-line'}>
                  <div className="bill-line-top">
                    <span className="line-art" style={{ background: tint.bg, color: tint.ink }}>
                      {initialsOf(l.product.name)}
                    </span>
                    <span className="line-what">
                      <strong>{l.product.name}</strong>
                      <span>
                        {formatPaise(l.unitPricePaise)} each · GST{' '}
                        {(l.product.taxRateBp / 100).toFixed(0)}%
                        {l.discountPaise > 0 && ` · −${formatPaise(l.discountPaise)}`}
                      </span>
                    </span>
                    <span className="line-total">{formatPaise(billLine?.totalPaise ?? 0)}</span>
                  </div>

                  <div className="bill-line-actions">
                    <span className="stepper">
                      <button
                        aria-label="One less"
                        onClick={() => setQuantity(l.product.id, l.quantityMilli - 1000)}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        value={formatQuantity(l.quantityMilli, precision)}
                        aria-label={`Quantity of ${l.product.name}`}
                        onChange={(e) => {
                          const parsed = parseQuantity(e.target.value, precision);
                          if (parsed !== null) setQuantity(l.product.id, parsed);
                        }}
                      />
                      <button
                        aria-label="One more"
                        onClick={() => setQuantity(l.product.id, l.quantityMilli + 1000)}
                      >
                        <Plus size={14} />
                      </button>
                    </span>
                    <button
                      className="icon-btn"
                      aria-label="Change price or discount"
                      onClick={() => setEditing(open ? null : l.product.id)}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  {open && (
                    <div className="bill-line-edit">
                      <label>
                        Price
                        <input
                          className="price-input"
                          inputMode="decimal"
                          value={(l.unitPricePaise / 100).toFixed(2)}
                          onChange={(e) => {
                            const parsed = parseRupees(e.target.value);
                            if (parsed !== null) {
                              setCart((c) =>
                                c.map((x) =>
                                  x.product.id === l.product.id
                                    ? { ...x, unitPricePaise: parsed }
                                    : x,
                                ),
                              );
                            }
                          }}
                        />
                      </label>
                      <label>
                        Discount
                        <input
                          className="price-input"
                          inputMode="decimal"
                          value={l.discountPaise ? (l.discountPaise / 100).toFixed(2) : ''}
                          placeholder="0.00"
                          onChange={(e) => {
                            const parsed = e.target.value ? parseRupees(e.target.value) : 0;
                            if (parsed !== null) {
                              setCart((c) =>
                                c.map((x) =>
                                  x.product.id === l.product.id
                                    ? { ...x, discountPaise: parsed }
                                    : x,
                                ),
                              );
                            }
                          }}
                        />
                      </label>
                      <button
                        className="icon-btn danger"
                        aria-label={`Remove ${l.product.name}`}
                        onClick={() => removeLine(l.product.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {held.length > 0 && (
            <div className="held">
              <h3>Held bills</h3>
              {held.map((h) => (
                <button key={h.id} className="held-item" onClick={() => resumeCart(h.id)}>
                  <PlayCircle size={14} /> {h.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bill-foot">
          <div className="totals">
            <div className="t-row">
              <span>Taxable value</span>
              <span>{formatPaise(bill?.taxablePaise ?? 0)}</span>
            </div>

            {bill && bill.itemDiscountPaise > 0 && (
              <div className="t-row">
                <span>Item discounts</span>
                <span>−{formatPaise(bill.itemDiscountPaise)}</span>
              </div>
            )}

            {bill?.taxBreakdown
              .filter((b) => b.taxPaise > 0)
              .map((b) => (
                <div className="t-row small" key={b.rateBp}>
                  <span>
                    {bill.isInterstate ? 'IGST' : 'CGST + SGST'} @ {(b.rateBp / 100).toFixed(0)}%
                  </span>
                  <span>{formatPaise(b.taxPaise)}</span>
                </div>
              ))}

            <div className="t-row discount-row">
              <span>Bill discount</span>
              <input
                inputMode="decimal"
                value={cartDiscount}
                onChange={(e) => setCartDiscount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            {bill && bill.roundOffPaise !== 0 && (
              <div className="t-row small">
                <span>Round off</span>
                <span>
                  {bill.roundOffPaise > 0 ? '+' : '−'}
                  {formatPaise(Math.abs(bill.roundOffPaise))}
                </span>
              </div>
            )}

            <div className="t-row grand">
              <span>Total</span>
              <span>{formatPaise(bill?.totalPaise ?? 0)}</span>
            </div>
          </div>

          <button
            className="btn-primary pay-btn"
            disabled={cart.length === 0 || !bill}
            onClick={() => setPaying(true)}
          >
            Take payment <kbd>F4</kbd>
          </button>

          <div className="pos-secondary">
            <button className="btn-secondary" onClick={holdCart} disabled={cart.length === 0}>
              <PauseCircle size={15} /> Hold · F8
            </button>
            <button className="btn-secondary" onClick={clearSale} disabled={cart.length === 0}>
              <X size={15} /> Clear
            </button>
          </div>
        </div>
      </aside>

      {paying && bill && (
        <PaymentDialog
          totalPaise={bill.totalPaise}
          settings={settings}
          busy={saving}
          error={payError}
          onConfirm={(payments) => void completeSale(payments)}
          onClose={() => {
            setPaying(false);
            setPayError(null);
          }}
        />
      )}

      {receipt && (
        <div className="modal-backdrop" onMouseDown={() => setReceipt(null)}>
          <div className="modal receipt-done" onMouseDown={(e) => e.stopPropagation()}>
            <CheckCircle2 size={40} />
            <h2>{receipt.invoiceNumber}</h2>
            <p className="amount">{formatPaise(receipt.bill.totalPaise)}</p>
            {receipt.changePaise > 0 && (
              <p className="change-due">Change due: {formatPaise(receipt.changePaise)}</p>
            )}
            {receipt.duplicate && (
              <p className="field-hint">This submission matched a sale already recorded.</p>
            )}
            <div className="page-actions" style={{ marginTop: 14 }}>
              <button className="btn-secondary" onClick={() => setPreviewSaleId(receipt.id)}>
                <Printer size={15} /> Print receipt
              </button>
              <button className="btn-primary" onClick={() => setReceipt(null)}>
                New sale
              </button>
            </div>
          </div>
        </div>
      )}

      {previewSaleId && (
        <ReceiptPreview
          saleId={previewSaleId}
          settings={settings}
          isReprint={false}
          onClose={() => setPreviewSaleId(null)}
        />
      )}

      {showCustomers && (
        <div className="modal-backdrop" onMouseDown={() => setShowCustomers(false)}>
          <div className="modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Choose customer</h2>
              <button className="icon-btn" onClick={() => setShowCustomers(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <ul className="customer-list">
                {customerList.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setCustomer(c);
                        setShowCustomers(false);
                      }}
                    >
                      <strong>{c.name}</strong>
                      {c.phone && <span>{c.phone}</span>}
                      {c.gstin && <em>{c.gstin}</em>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
