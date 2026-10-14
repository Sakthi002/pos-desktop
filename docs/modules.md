# The modules, one by one

Every feature in the app follows the same shape: a screen in `src/renderer`, a
service in `src/main/services` that owns the rules, a repository in
`src/main/db/repositories` that owns the SQL, and types in `src/shared` that
both sides agree on. This is the map.

---

## Setup — the first run

**Screen** `pages/SetupWizard.tsx` · **Service** `setup-service.ts`

Five steps: the shop and its GSTIN, how invoices are numbered, tax, the
receipt, and a review. Completing it writes the company, the branch, the first
operator, the walk-in customer and both invoice sequences **in one
transaction** — a half-made shop is not a state the app can be in.

Currency is fixed to INR and the timezone defaults to Asia/Kolkata; both are
shown on the review step rather than asked.

---

## Settings

**Screen** `pages/Settings.tsx` · **Service** `settings-service.ts` ·
**Table** `settings` (one row per section, JSON)

Ten sections: shop, locale, invoice, tax, receipt, **template**, payment,
inventory, backup, security, loyalty. Reads merge stored values over the
schema's defaults, so a section added by a later version is simply absent and
takes its defaults instead of failing to load. Writes are validated as a whole
before they touch the database, and only the keys actually sent are applied —
a partial update never resets a field it did not mention.

Tabs: Shop profile · Invoicing & tax · Receipt & payments · **Bill template** ·
Inventory · Points · Drawer · Accounts · Users · Backup & restore · Audit
trail.

---

## Catalogue — products, categories, units

**Screens** `pages/Products.tsx`, `Categories.tsx` ·
**Service** `catalogue-service.ts` · **Tables** `products`, `categories`, `units`

Products carry a name, SKU, barcode, HSN, unit, selling price, cost, tax rate
and whether that price includes tax, a reorder level, and three price levels
(retail, wholesale, special). Search covers name, SKU and barcode. Duplicate
SKUs and barcodes are refused.

CSV import reports errors per row and leaves the good rows in; CSV export
re-imports cleanly. Shelf labels print from here (`components/LabelDialog.tsx`)
on three sheet sizes, with a Code 128 barcode this app encodes itself — a label
that prints but does not scan is worse than none.

A product is never deleted, only deactivated.

---

## Billing — the till

**Screen** `pages/Pos.tsx` · **Service** `sale-service.ts` ·
**Engine** `src/shared/billing.ts` · **Tables** `sales`, `sale_items`,
`payments`, `inventory_movements`, `invoice_sequences`

The till is one screen: scan or search, quantity, price override if allowed,
discounts per line or on the whole bill, then payment — cash, UPI, card, bank,
or several at once, with change calculated. F2 searches, F4 pays, F8 holds a
bill for later.

`calculateBill` is the only arithmetic: tax-inclusive or exclusive, per-line
and cart discounts, CGST+SGST within the state and IGST across it, rounding to
the rupee if the shop asks. The same function prices a quotation and the
preview in Settings, so what a customer is promised and what they are charged
cannot drift apart. The rules are written out in `docs/calculations.md`.

A sale commits header, lines, payments, stock movements, loyalty and its
ledger voucher in one transaction, with the invoice number allocated **inside**
it so a failure burns no number.

---

## Sales history, voids and returns

**Screens** `pages/Sales.tsx`, `components/ReturnDialog.tsx`,
`components/VoidSaleDialog.tsx` · **Services** `sale-service.ts`,
`return-service.ts` · **Tables** `sales_returns`, `sales_return_items`

Search by number, customer or phone; reprint; export. A sale is never deleted:
it is **voided** with a reason, which reverses its stock and posts a reversing
voucher, or partly **returned** as a credit note that puts the goods back in
the batch they came from and refunds what was paid. Both keep the original
document intact.

---

## Inventory

**Screen** `pages/Inventory.tsx` · **Services** `inventory-service.ts`,
`batch-service.ts` · **Tables** `inventory_movements`, `product_batches`

Stock is the sum of its movements, never a stored number. The screen shows the
list, what is running low, the movement history of any product, and manual
adjustments which demand a reason.

**Batches** are per product — a shop selling soap is never asked for an expiry
date. A batch carries its number, its dates and the cost it actually arrived
at; the till takes the earliest expiry first, an expired batch is refused
rather than warned about, and returns go back into the batch they came from.
Valuation is FIFO, LIFO or average, per product. See `docs/batches.md`.

---

## Buying — suppliers, orders, purchases

**Screens** `pages/Suppliers.tsx`, `PurchaseOrders.tsx`, `Purchases.tsx` ·
**Services** `supplier-service.ts`, `purchase-order-service.ts`,
`purchase-service.ts`

```
Purchase order  ──"goods arrived"──▶  Purchase (supplier's bill)  ──▶  Payment
   no stock                            stock in, money owed            owed down
   nothing owed                        ledger voucher                  voucher
```

A **purchase order** says what the shop wants, at what cost, by when. It
carries no tax — what is charged is the supplier's bill to say. Receiving one
opens the purchase screen prefilled, and saving that bill marks the order
received inside the bill's own transaction, so one order cannot be received
twice. See `docs/purchase-orders.md`.

A **purchase** brings stock in, records batches and expiry where the product
keeps them, can push the MRP onto the product as its new selling price, and
either settles at the counter or leaves money owed. Purchase returns (debit
notes) and supplier payments both post their own vouchers.

---

## Customers, credit and loyalty

**Screens** `pages/Customers.tsx`, `components/CustomerAccountDialog.tsx`,
`components/LoyaltyPanel.tsx` · **Services** `customer-service.ts`,
`counter-service.ts`, `loyalty-service.ts`

A customer carries a phone, a GSTIN, a state (which decides CGST+SGST versus
IGST), a price level and a credit limit. What they owe is **derived from the
documents** and lands on their own line in the receivables control, so the
counter and the books cannot disagree. A bill may be left part-paid only
against a named customer, inside their limit, and only when the shortfall is
ticked — an underpaid bill with nothing ticked is a mistake and is refused as
one.

Loyalty is a card per customer with its own tier, earning rate and expiry;
points earned and redeemed are stored with the sale, so a reprint shows what
the customer was actually told. See `docs/loyalty.md` and `docs/trade.md`.

---

## Quotations

**Screen** `pages/Quotations.tsx` · **Service** `quotation-service.ts`

A price put in writing before anything is sold: no stock, no money, nothing in
the books. Its own number series, a validity date read rather than stored, and
billing it opens the till with the quoted lines at the quoted prices. A second
bill against the same quotation is refused. See `docs/quotations.md`.

---

## The counter — shifts and the drawer

**Panel** `components/ShiftPanel.tsx` · **Service** `counter-service.ts` ·
**Table** `shifts`

A shift opens with a float and closes with a count. What the drawer should
hold is computed from the session's own cash — takings net of change, less
refunds and anything paid out — and the difference is recorded, never
corrected away.

---

## The books

**Panel** `components/BooksPanel.tsx` · **Service** `ledger-service.ts` ·
**Tables** `accounts`, `vouchers`, `ledger_entries`

Double entry, posted from the documents inside their own transactions, with
`postMissing()` catching up at startup. Trial balance, ledgers by account and
party, and manual journals for the cases the documents do not cover. A voucher
is never edited; a correction is a reversing voucher.

---

## Reports and the dashboard

**Screens** `pages/Reports.tsx`, `Dashboard.tsx` ·
**Services** `report-service.ts`, `dashboard-service.ts`

**Twenty reports**, defined once in `docs/reports.md` and listed in
`src/shared/reports.ts`:

| Selling | Buying | Stock | Books & counter |
| --- | --- | --- | --- |
| Sales summary | Purchases | Stock on hand | Trial balance |
| Daily sales | Purchase returns | Stock movement | Cash book |
| Product-wise sales | Supplier outstanding | Low stock | Day book |
| Category-wise sales | | Expiring stock | Shifts and the drawer |
| Payment methods | | | What customers owe |
| Tax summary | | | |
| Discounts | | | |
| Returns | | | |

Every one takes a date range and exports to CSV.

The dashboard is the glance: takings today and over seven days against the
spans before them, the average bill, what is expiring, what is running low,
the payment mix and the last ten bills.

---

## Backup, restore and the audit trail

**Panels** `components/BackupPanel.tsx`, `AuditPanel.tsx` ·
**Services** `backup-service.ts`, `backup-scheduler.ts`

Backups use SQLite's own backup API, never a file copy — a copy can miss
uncheckpointed WAL data. Every backup is verified after writing and carries
the app and schema version inside it. Restore refuses a file from a newer
schema. A scheduler can take one on a timer, and the UI nags about keeping a
copy off the machine.

`audit_logs` is append-only, enforced by triggers: who did what, when, with
the details. A mistake is corrected with another entry, never by editing one.

---

## Users and sign-in

**Panel** `components/UsersPanel.tsx` · **Service** `auth-service.ts`

Optional sign-in, three roles, an idle lock measured in minutes, and an
approval rule for large voids and returns. Turning sign-in on asks for a
sign-in immediately rather than leaving the window in a state where nothing
can be saved. See `docs/users.md`.
