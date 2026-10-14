# How the app is built

Universal POS is one shop's till, on one Windows computer, with no internet.
Everything it knows lives in a single SQLite file on that machine. There is no
server to be down, no account to log into, and nothing to pay monthly. That
decision shapes every other one in this document.

---

## 1. The three processes

Electron gives the app three separate pieces of JavaScript. They are not
interchangeable, and the boundary between them is the main safety rule of the
codebase.

```
┌──────────────────────────────────────────────────────────────────────┐
│  MAIN  (Node.js)                            src/main                 │
│  • opens the window            • owns the SQLite connection          │
│  • holds every IPC handler     • reads and writes files              │
│  • prints, exports PDFs        • runs migrations, backups, the ledger│
└───────────────▲──────────────────────────────────────────────────────┘
                │  invoke(channel, payload) → { ok, data } | { ok, error }
┌───────────────┴──────────────────────────────────────────────────────┐
│  PRELOAD  (bridge)                          src/preload              │
│  exposes exactly one function on window.api: invoke()                │
│  contextIsolation on, nodeIntegration off                            │
└───────────────▲──────────────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────────────┐
│  RENDERER  (React)                          src/renderer             │
│  • screens, forms, keyboard                 • no fs, no SQL,         │
│  • calls window.api.invoke and nothing else   no child_process       │
└──────────────────────────────────────────────────────────────────────┘
```

`src/shared` is the fourth directory and belongs to both sides: types, the IPC
contract, and the pure arithmetic (money, quantity, billing, documents). It
imports nothing from Node and nothing from React, which is why the same
`calculateBill` runs in a test, in the main process and — for previews — in
the renderer.

**The renderer never touches Node.** ESLint enforces it with
`no-restricted-imports`. If a screen needs something new, the only route in is
a new channel in the contract.

---

## 2. One way in: the IPC contract

`src/shared/ipc-contract.ts` is the whole API surface — **123 channels** at the
time of writing. Each one appears three times, and TypeScript refuses to build
if the three disagree:

```ts
// 1. the request shape, as a Zod schema
'sales:create': saleInputSchema,

// 2. the response type
'sales:create': SaleReceipt,

// 3. who may call it            (src/shared/permissions.ts)
'sales:create': 'sell',
```

`registerHandler` parses the payload **before** the handler runs, so no handler
ever sees an unvalidated shape, and the gate checks the caller's permission
before that. A handler returns `{ ok: true, data }` or `{ ok: false, error }`;
it never throws across the bridge, and an internal error is logged in main and
returned as a generic message — a SQL string or a file path must never reach a
screen.

```
renderer                 preload            main
   │  call('sales:create', input)
   ├──────────────────────────────────────────▶ gate: public? permission?
   │                                            Zod parse of the payload
   │                                            service → repository → SQLite
   ◀──────────────────────────────────────────┤ { ok: true, data: receipt }
   │  throws IpcCallError on { ok: false }
```

The 123 channels, by area:

| | | | |
| --- | --- | --- | --- |
| products 10 | customers 7 | catalogue 5 | labels 3 |
| quotations 7 | loyalty 7 | auth 5 | the counter 3 |
| purchases 7 | the ledger 7 | shifts 4 | app 2 |
| purchase orders 7 | suppliers 6 | settings 4 | batches 2 |
| sales 5 | users 5 | backups 4 | inventory 2 |
| printing 5 | dialogs 5 | returns 3 | setup 2 |
| WhatsApp 3 | reports 1 | dashboard 1 | audit 1 |

---

## 3. One way through: renderer → service → repository → SQLite

```
Screen (React)
   │  window.api.invoke
Service   src/main/services/*.ts     business rules, transactions, the ledger
   │
Repository  src/main/db/repositories/*.ts   the only code that writes SQL
   │
SQLite    one file in Electron's userData
```

Nothing short-circuits it. A page never builds SQL; a repository never decides
policy; a service never renders HTML. The documents a shop prints are built in
`src/shared` from data the main process read itself, which is why a renderer
can ask for a bill without being trusted to say what is on it.

---

## 4. The database

**Where.** Electron's `userData` directory — on Windows,
`%APPDATA%\universal-pos\pos.db`; on this Linux machine,
`~/.config/pos-desktop/pos.db`. Never the install directory, so an update
cannot destroy a shop's data.

**How it is opened.** WAL journal mode, `foreign_keys = ON`,
`busy_timeout = 5000`.

**What is in it.** 41 tables after migration 013, with 119 indexes and 20
triggers. The triggers are not decoration: they are the last line of defence
for the rules below.

| Area | Tables |
| --- | --- |
| Identity | `companies`, `branches`, `operators`, `settings` |
| Catalogue | `products`, `categories`, `units`, `product_batches` |
| Selling | `sales`, `sale_items`, `payments`, `invoice_sequences` |
| Returns | `sales_returns`, `sales_return_items` |
| Stock | `inventory_movements` |
| Buying | `suppliers`, `purchases`, `purchase_items`, `purchase_sequences`, `purchase_returns`, `purchase_return_items`, `supplier_payments` |
| Ordering | `purchase_orders`, `purchase_order_items`, `purchase_order_sequences` |
| Quoting | `quotations`, `quotation_items`, `quotation_sequences` |
| Customers | `customers`, `customer_receipts`, `loyalty_cards`, `loyalty_transactions` |
| Books | `accounts`, `vouchers`, `ledger_entries`, `voucher_sequences` |
| Counter | `shifts` |
| Housekeeping | `audit_logs`, `backup_metadata`, `schema_migrations`, `sync_queue` |

**Migrations are forward-only.** `src/main/db/migrations/` holds 001 to 013,
each a version, a name and a block of SQL. They run at startup inside a
transaction, newest last, and an applied one is never edited — a shop that
installed last month and a shop installing today must end at the same schema
by the same path.

```
001 initial          005 audit append-only   009 loyalty        013 purchase orders
002 sale idempotency 006 purchases           010 batches
003 no delete sales  007 ledger              011 trade terms
004 returns tax split 008 users              012 quotations
```

---

## 5. Rules the whole codebase keeps

**Money is integer paise. Quantity is integer thousandths.** No floating point
touches a financial path. `src/shared/money.ts` and `quantity.ts` parse strings
to integers and format them back at the display edge only. ₹1,523.00 is
`152300`; 1.5 kg is `1500`.

**Stock changes only through movements.** No code writes a stock balance. A
sale, a return, a purchase, an adjustment and a batch all insert rows into
`inventory_movements`, and a balance is the sum of them. This is why stock can
always be explained.

**Multi-statement writes run in one transaction.** A sale writes its header,
its lines, its payments, its stock movements, its loyalty points and its
ledger voucher atomically or not at all. The same is true of a purchase, a
return and a receipt.

**Documents are never edited or deleted.** A completed sale, a quotation, a
purchase order and an audit entry are facts. A mistake is corrected by another
document — a void, a credit note, a cancellation with a reason, a reversing
voucher. Triggers refuse the delete outright.

**Soft-deactivate anything a transaction references.** Products, suppliers and
customers go inactive; they never disappear from a bill that mentions them.

**Every syncable row carries a UUID** from creation, even though v1 never
syncs. Invoice numbers are a local per-branch sequence and are deliberately
*not* globally unique.

**Idempotency keys** on sales, purchases, quotations and orders: the same
submission arriving twice — a double tap, a retry after a crash — is the first
one, not a second document.

---

## 6. The books post themselves

`src/main/services/ledger-service.ts` turns documents into double-entry
vouchers **inside the transaction that writes the document**: `postSale`,
`postSaleReturn`, `postSaleVoid`, `postPurchase`, `postPurchaseReturn`,
`postPurchaseCancel`, `postSupplierPayment`, `postCustomerReceipt`,
`postLoyaltyAdjustment`, `postJournal`, `postOpeningBalances`.

Posting is idempotent, and `postMissing()` runs at startup to catch anything a
crash left unposted. The books are therefore *derived*: they can be rebuilt
from the documents at any time, and a voucher is never edited — a correction
is a reversing voucher.

---

## 7. Who may do what

Three roles, fourteen permissions, enforced at the IPC gate — the UI hides
what a role cannot do, but hiding a button is a courtesy, not a control.

| Role | Can |
| --- | --- |
| Owner (`admin`) | Everything, including users, settings and backups |
| Manager | The shop day to day: billing, stock, purchases, reports, books |
| Cashier | `sell`, `sale.view`, `customer.manage` — and nothing else |

Sign-in is optional. A one-person shop runs with it off and the app opens on
the till; a shop with staff turns it on, and then each sale records who rang
it up. Passwords are scrypt with their parameters stored beside the hash, so
the cost can be raised later without locking anyone out.

See `docs/users.md`.

---

## 8. Printing and documents

One function builds each document, and the preview, the PDF and the paper all
come from it — they cannot disagree about a total because they are the same
HTML:

| Document | Built by |
| --- | --- |
| Receipt and A4 tax invoice | `src/shared/receipt.ts` |
| Quotation | `src/shared/quotation-document.ts` |
| Purchase order | `src/shared/purchase-order-document.ts` |
| Shelf labels | `src/shared/labels.ts` (Code 128 encoded in `barcode.ts`) |
| The UPI pay code | `src/shared/qr.ts` |

`print-service.ts` loads that HTML into an offscreen window and hands it to
Chromium to print or to `printToPDF`. A4 bills take their margins from the
document's own `@page` rule; thermal rolls get an explicit page size in
microns. A failed print returns a readable reason, not Chromium's wording.

The dress of a bill — four themes, the shop's colour, which columns show — is
in `docs/templates.md`.

---

## 9. Build, test and package

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron and Vite with hot reload |
| `npm run build` | Typecheck, then build all three processes |
| `npm run typecheck` | `tsc --noEmit` for the node and web configs |
| `npm run lint` | ESLint, including the renderer's import ban |
| `npm test` | Vitest — **577 tests** |
| `npm run rebuild` | Rebuild `better-sqlite3` for Electron's ABI |
| `npm run package:win` | Windows NSIS installer into `release/` |

TypeScript is strict, including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. The one runtime dependency is `better-sqlite3`;
everything else is a dev dependency bundled at build time.

**The native module has two ABIs.** `npm test` wants the Node build and the
app wants the Electron one — whichever ran last wins, so `npm run rebuild`
after switching.

About 43,000 lines of TypeScript, of which 8,700 are tests.

---

## 10. What this architecture refuses to do

- **No network.** Nothing in the app opens a socket. A shop's data never
  leaves the computer it was typed into.
- **No multi-branch.** Every document already carries its branch, but a second
  branch needs stock transfers and two computers that agree about what
  happened — the sync problem v1 does not solve. `docs/trade.md` says why.
- **No template designer.** The body of a tax invoice is a legal document
  whose layout has been tested; what differs between shops is the dress.
