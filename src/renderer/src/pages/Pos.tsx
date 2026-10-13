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
  PackageOpen,
  LayoutGrid,
  Star,
} from 'lucide-react';
import { call } from '../lib/ipc';
import { hueFor, hueStyle } from '../lib/hues';
import { PaymentDialog } from '../components/PaymentDialog';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { UNCATEGORISED, type Category, type Product } from '@shared/catalogue';
import type { Customer } from '@shared/customer';
import type { Bill } from '@shared/billing';
import type { PaymentInput, SaleReceipt } from '@shared/sale';
import { formatPaise, parseRupees } from '@shared/money';
import { formatQuantity, parseQuantity, precisionFor } from '@shared/quantity';
import type { AppSettings } from '@shared/settings';
import { TIER_LABELS, type LoyaltyAtTill } from '@shared/loyalty';
import {
  PRICE_LEVELS,
  PRICE_LEVEL_LABELS,
  priceAt,
  type CustomerAccount,
  type PriceLevel,
} from '@shared/trade';

interface CartLine {
  product: Product;
  quantityMilli: number;
  unitPricePaise: number;
  discountPaise: number;
  /** True once the operator has typed a price, so changing the list leaves it. */
  priceOverridden?: boolean;
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
  { bg: '#eef0ff', ink: '#4f46e5' },
  { bg: '#f4edff', ink: '#7c3aed' },
  { bg: '#e3f7f4', ink: '#0d9488' },
  { bg: '#fef2e2', ink: '#c2620a' },
  { bg: '#ffe8ee', ink: '#e11d48' },
  { bg: '#e3f3fd', ink: '#0284c7' },
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

export function Pos({
  settings,
  quotationId = null,
  onQuotationLoaded,
}: {
  settings: AppSettings;
  /** A quotation to bill: its lines, customer and prices fill the till. */
  quotationId?: string | null;
  onQuotationLoaded?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cartDiscount, setCartDiscount] = useState('');
  const [points, setPoints] = useState<LoyaltyAtTill | null>(null);
  const [priceLevel, setPriceLevel] = useState<PriceLevel>('retail');
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [rawBill, setBill] = useState<Bill | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  /** Bumped by anything that moves stock, so the wall re-reads it. */
  const [stockVersion, setStockVersion] = useState(0);
  /** Set while a quoted price is being billed, so the sale can settle it. */
  const [billingQuotation, setBillingQuotation] = useState<string | null>(null);
  const [quotedFrom, setQuotedFrom] = useState<string | null>(null);
  const [unfiled, setUnfiled] = useState(0);
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
    // A product nobody has filed is still a product to sell, so the rail
    // offers them together rather than leaving them findable only by search.
    void call('products:search', { status: 'active', categoryId: UNCATEGORISED, pageSize: 10 })
      .then((page) => setUnfiled(page.total))
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
  }, [activeCategory, stockVersion]);

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
      redeemPoints,
      priceLevel,
    }),
    [cart, customer, cartDiscount, redeemPoints, priceLevel],
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

  // What this customer's card could pay for, asked of the main process so the
  // caps are the same ones the sale will apply.
  const billBeforePoints = (bill?.totalPaise ?? 0) + (bill?.loyaltyDiscountPaise ?? 0);
  const cardHolderId = customer?.isWalkIn ? null : (customer?.id ?? null);

  useEffect(() => {
    if (!cardHolderId || billBeforePoints === 0) return;
    let cancelled = false;
    void call('loyalty:atTill', { customerId: cardHolderId, billPaise: billBeforePoints })
      .then((result) => {
        if (!cancelled) setPoints(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cardHolderId, billBeforePoints]);

  // A customer brings their own price list and their own account. Both are
  // read when they are chosen rather than held on the till, so a limit raised
  // in another window is the one that applies here.
  useEffect(() => {
    if (!cardHolderId) return;
    void call('counter:account', { customerId: cardHolderId })
      .then(setAccount)
      .catch(() => undefined);
  }, [cardHolderId]);

  // Derived, not stored: an empty cart or a walk-in has nothing to offer, and
  // the last customer's card must not linger on screen while the next ask is
  // still in flight.
  const offer = cardHolderId && billBeforePoints > 0 && points?.card ? points : null;

  // A quoted price being billed: the lines come back priced as they were
  // promised, so the customer pays what the paper said even if the shelf price
  // has moved since.
  useEffect(() => {
    if (!quotationId) return;
    let cancelled = false;

    void call('quotations:get', { id: quotationId })
      .then(async (quotation) => {
        if (cancelled) return;
        const page = await call('products:search', { status: 'all', pageSize: 200 });
        const byId = new Map(page.items.map((p) => [p.id, p]));

        setCart(
          quotation.bill.lines.flatMap((line) => {
            const product = line.productId ? byId.get(line.productId) : undefined;
            return product
              ? [
                  {
                    product,
                    quantityMilli: line.quantityMilli,
                    unitPricePaise: line.unitPricePaise,
                    discountPaise: line.totalDiscountPaise,
                    priceOverridden: true,
                  },
                ]
              : [];
          }),
        );
        setPriceLevel(quotation.priceLevel);
        if (quotation.customerId) {
          const list = await call('customers:search', { term: quotation.customerName ?? '' });
          const match = list.find((c) => c.id === quotation.customerId);
          if (match) setCustomer(match);
        }
        setBillingQuotation(quotation.id);
        setQuotedFrom(quotation.quotationNumber);
        onQuotationLoaded?.();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

    return () => {
      cancelled = true;
    };
  }, [quotationId, onQuotationLoaded]);

  // ─── Cart ─────────────────────────────────────────────────────────────────

  const addProduct = useCallback(
    (product: Product) => {
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
            unitPricePaise: priceAt(priceLevel, product),
            discountPaise: 0,
          },
        ];
      });
      setSearch('');
      setResults([]);
      searchRef.current?.focus();
    },
    [priceLevel],
  );

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

  // Moving a bill to another price list re-prices it, except for lines the
  // operator has already overridden by hand.
  const changeLevel = (level: PriceLevel) => {
    setPriceLevel(level);
    setCart((current) =>
      current.map((line) =>
        line.priceOverridden ? line : { ...line, unitPricePaise: priceAt(level, line.product) },
      ),
    );
  };

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
    setRedeemPoints(0);
    setCartDiscount(entry.cartDiscountPaise ? (entry.cartDiscountPaise / 100).toFixed(2) : '');
    setHeld((h) => h.filter((x) => x.id !== id));
    idempotencyKey.current = crypto.randomUUID();
  }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  async function completeSale(payments: PaymentInput[], onCredit = false) {
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
        redeemPoints,
        priceLevel,
        onCredit,
        payments,
        ...(billingQuotation ? { quotationId: billingQuotation } : {}),
      });
      setReceipt(result);
      setPaying(false);
      clearSale();
      setBillingQuotation(null);
      setQuotedFrom(null);
      // The sale has just taken stock off the shelf; the wall is showing what
      // was there a moment ago until it reads it again.
      setStockVersion((v) => v + 1);
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
        <div className="pos-browse">
          {/* A rail holding nothing but "All" is only a thinner screen. */}
          {categories.length > 0 && (
            <nav className="cat-rail" aria-label="Categories">
              <button
                className={activeCategory === '' ? 'cat on' : 'cat'}
                style={hueStyle('indigo')}
                onClick={() => setActiveCategory('')}
              >
                <span className="cat-mark">
                  <LayoutGrid size={18} />
                </span>
                <span>All</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={activeCategory === c.id ? 'cat on' : 'cat'}
                  style={hueStyle(hueFor(c.name))}
                  onClick={() => setActiveCategory(c.id)}
                >
                  <span className="cat-mark">
                    <Package size={18} />
                  </span>
                  <span>{c.name}</span>
                </button>
              ))}
              {unfiled > 0 && (
                <button
                  className={activeCategory === UNCATEGORISED ? 'cat on' : 'cat'}
                  style={hueStyle('rose')}
                  onClick={() => setActiveCategory(UNCATEGORISED)}
                  title={`${unfiled} product${unfiled === 1 ? '' : 's'} with no category`}
                >
                  <span className="cat-mark">
                    <PackageOpen size={18} />
                  </span>
                  <span>Unfiled</span>
                </button>
              )}
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
                  const out = p.trackInventory && p.stockMilli <= 0;
                  const low =
                    p.trackInventory &&
                    !out &&
                    p.reorderLevelMilli > 0 &&
                    p.stockMilli <= p.reorderLevelMilli;
                  return (
                    <button key={p.id} className="tile" onClick={() => addProduct(p)}>
                      <span className="tile-art" style={{ background: tint.bg, color: tint.ink }}>
                        {initialsOf(p.name)}
                        {p.trackInventory && (
                          <span className={`tile-stock${out ? ' out' : low ? ' low' : ''}`}>
                            {out
                              ? 'None left'
                              : `${formatQuantity(p.stockMilli, precision)} ${p.unitCode}`}
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
              <span>
                {customer?.gstin ??
                  (settings.tax.registered ? 'No GST details on this bill' : 'Walk-in sale')}
              </span>
            </span>
            <span className="change-link">Change</span>
          </button>

          {quotedFrom && (
            <div className="quoted-strip">
              Billing quotation <strong>{quotedFrom}</strong> · prices as quoted
            </div>
          )}

          {priceLevel !== 'retail' || (account && account.creditLimitPaise > 0) ? (
            <div className="terms-strip">
              <select
                className="level-select"
                value={priceLevel}
                onChange={(e) => changeLevel(e.target.value as PriceLevel)}
                aria-label="Price list for this bill"
              >
                {PRICE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PRICE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
              {account && account.creditLimitPaise > 0 && (
                <span className="terms-note">
                  Owes {formatPaise(account.outstandingPaise)} of{' '}
                  {formatPaise(account.creditLimitPaise)}
                </span>
              )}
            </div>
          ) : null}

          {offer?.card && (
            <div className="points-strip">
              <span className="points-balance">
                <Star size={13} />
                {offer.card.balancePoints} points · {TIER_LABELS[offer.card.tier]}
              </span>

              {offer.blockedReason ? (
                <span className="points-note">{offer.blockedReason}</span>
              ) : redeemPoints > 0 ? (
                <button className="link-btn" onClick={() => setRedeemPoints(0)}>
                  Using {redeemPoints} · remove
                </button>
              ) : (
                <button
                  className="link-btn"
                  onClick={() => setRedeemPoints(offer.maxRedeemablePoints)}
                >
                  Use {offer.maxRedeemablePoints} ({formatPaise(offer.maxRedeemablePaise)})
                </button>
              )}
            </div>
          )}
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
                        {formatPaise(l.unitPricePaise)} each
                        {settings.tax.registered &&
                          ` · GST ${(l.product.taxRateBp / 100).toFixed(0)}%`}
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
                                    ? { ...x, unitPricePaise: parsed, priceOverridden: true }
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
              <h3>
                <PauseCircle size={13} /> Held bills
                <span className="count">{held.length}</span>
              </h3>
              {held.map((h) => (
                <button key={h.id} className="held-item" onClick={() => resumeCart(h.id)}>
                  <PlayCircle size={15} /> <strong>{h.label}</strong>
                  <span className="resume">Resume</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bill-foot">
          <div className="totals">
            <div className="t-row">
              <span>{settings.tax.registered ? 'Taxable value' : 'Value'}</span>
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

            {bill && (bill.loyaltyDiscountPaise ?? 0) > 0 && (
              <div className="t-row">
                <span>Points used</span>
                <span>−{formatPaise(bill.loyaltyDiscountPaise ?? 0)}</span>
              </div>
            )}

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
            <button className="btn-warn" onClick={holdCart} disabled={cart.length === 0}>
              <PauseCircle size={15} /> Hold · F8
            </button>
            <button className="btn-danger soft" onClick={clearSale} disabled={cart.length === 0}>
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
          credit={
            account && account.creditLimitPaise > 0
              ? {
                  customerName: account.customerName,
                  availablePaise: account.availablePaise,
                }
              : null
          }
          onConfirm={(payments, onCredit) => void completeSale(payments, onCredit)}
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
              <button className="btn-info" onClick={() => setPreviewSaleId(receipt.id)}>
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
                        setRedeemPoints(0);
                        changeLevel(c.priceLevel);
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
