# Universal POS — Offline-First Desktop Billing Software

Living plan and progress checklist. Tick items as they are **completed and verified**,
never when merely written. Update the Progress Log at the bottom after each phase.

---

## 1. Scope

**v1.0 target:** one shop, one Windows computer, no internet required for any daily operation.

### Target businesses

Grocery and general stores, supermarkets, textile and clothing, hardware and electrical,
electronics, stationery, and similar retail.

**Pharmacies are out of scope for v1.** They require batch numbers, expiry dates and
schedule-drug handling, which means batch-level inventory rather than per-product stock.
That is a schema-level difference, so it is deferred deliberately rather than bolted on.

### In scope for v1.0

| Area        | Included                                                               |
| ----------- | ---------------------------------------------------------------------- |
| Setup       | First-run wizard, shop profile, settings                               |
| Catalogue   | Products, categories, units, CSV import/export, stock adjustment       |
| Billing     | POS screen, barcode, discounts, tax, split payments, change due        |
| Receipts    | 58mm, 80mm, A4, PDF, reprint                                           |
| Sales       | History, search, filters, invoice detail, void with audit              |
| Returns     | Against original invoice, partial, restock control                     |
| Inventory   | Movement ledger, balances, low-stock alerts, adjustments               |
| Customers   | Walk-in and named, purchase history                                    |
| Reports     | Daily sales, date range, product, category, payment method, tax, stock |
| Data safety | Backup, restore, audit trail                                           |
| Release     | Test suite, Windows installer, documentation                           |

### Deferred to v1.1+

Purchases and suppliers · Expenses · Cash sessions and day-closing · Credit sales and
outstanding balances · Receipt template editor (v1 ships fixed templates) · Barcode label
printing · Multi-branch · Cloud sync · Pharmacy batch and expiry tracking

Opening stock and manual adjustments cover stock entry in v1, so purchases can wait.

---

## 2. Architecture

```
React renderer  (TypeScript, Vite)
      │  window.api.*  — narrow, validated IPC surface only
      ▼
Electron preload  (contextBridge, context isolation on, node integration off)
      │
      ▼
Electron main process
      │
      ▼
Services  (products, sales, inventory, payments, reports, printing, backup)
      │
      ▼
Repositories  (parameterised SQL, transactions)
      │
      ▼
SQLite  (WAL mode, foreign keys on, in userData)
```

**Rules**

- The renderer never opens the database, runs SQL, touches the filesystem or spawns processes.
- Business logic lives in services, not React components.
- Repositories are the only code that writes SQL, so a future cloud backend swaps this layer alone.
- Every IPC handler validates its input before use.

### Technology decisions

| Decision  | Choice                                                                             | Rationale                                                              |
| --------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Language  | **TypeScript**                                                                     | Money, IPC payloads and invoice snapshots need compile-time guarantees |
| UI        | React + Vite + React Router                                                        | Matches the existing codebase                                          |
| Icons     | lucide-react                                                                       | Already used in the current app                                        |
| Desktop   | Electron                                                                           | Windows installer, printing, filesystem access                         |
| Database  | SQLite via `better-sqlite3`                                                        | Synchronous, fast, mature; native rebuild handled in Phase 0           |
| Money     | **Integer paise**                                                                  | No binary floating point anywhere in financial paths                   |
| Quantity  | Integer thousandths                                                                | Supports kg/litre/metre without float drift                            |
| Rounding  | Half-up at line level; invoice total to nearest rupee with explicit round-off line | Indian retail convention; documented in `docs/calculations.md`         |
| Testing   | Vitest                                                                             | Logic and service tests                                                |
| Packaging | electron-builder                                                                   | NSIS installer for Windows                                             |

### Identifiers

Every syncable entity carries a UUID from creation, even though v1 never syncs. Invoice
numbers are a local sequence scoped to branch, allocated inside the sale transaction, and
are **not** assumed globally unique.

---

## 3. Phases and checklist

### Phase 0 — Foundation

- [x] Initialise project: Vite + React + TypeScript
- [x] Add Electron with main / preload / renderer separation
- [x] Context isolation on, node integration off, sandbox where compatible
- [x] Strict Content Security Policy
- [x] `contextBridge` exposing a typed, narrow `window.api`
- [x] IPC input validation helper (schema-checked at the boundary)
- [x] `better-sqlite3` installed and rebuilt for Electron, verified by opening a database
- [x] ESLint + Prettier + `tsc --noEmit` all clean
- [x] npm scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `package`
- [x] `CLAUDE.md` written
- [x] App window opens and renders a placeholder screen

### Phase 0b — Printer spike (de-risk early)

- [ ] Identify the target thermal printer model
- [ ] Print a hardcoded 80mm receipt from Electron on real hardware
- [ ] Confirm whether silent printing works, or a dialog is required
- [ ] Record findings in `docs/printing.md`

> Deliberately before the feature work. If the printer cannot be driven reliably,
> the whole product design changes, and that must be known in week one.

### Phase 1 — Database

- [x] Migration runner with `schema_migrations` and forward-only versioning
- [x] WAL mode, `foreign_keys = ON`, busy timeout configured
- [x] Database stored in Electron `userData`, never the install directory
- [x] Schema: companies, branches, operators, settings
- [x] Schema: categories, units, products
- [x] Schema: customers
- [x] Schema: sales, sale_items, payments
- [x] Schema: inventory_movements
- [x] Schema: sales_returns, sales_return_items
- [x] Schema: audit_logs, invoice_sequences, sync_queue
- [x] Indexes for barcode, SKU, product name, sale date, invoice number
- [x] Repository layer with parameterised queries and a `transaction()` helper
- [x] Migration test: fresh database builds to current version
- [x] Round-trip test: write and read every table

### Phase 2 — Settings and first-run wizard

- [x] Settings service with typed get/set and validation
- [x] First-run detection
- [x] Wizard: shop name, address, phone, email, GSTIN
- [x] Wizard: business category, currency (INR), timezone (Asia/Kolkata)
- [x] Wizard: invoice prefix and starting number
- [x] Wizard: tax-inclusive or tax-exclusive default
- [x] Wizard: receipt paper size, payment methods, logo
- [x] Creates default company, branch and operator records
- [x] All values editable later from Settings
- [x] Skipping optional fields works

### Phase 3 — Products, categories, units

- [x] Units with precision rules (piece, box, pack, kg, g, litre, ml, metre, dozen)
- [x] Categories CRUD
- [x] Product CRUD with full field set
- [x] Non-inventory service items that do not affect stock
- [x] Search by name, SKU, barcode
- [x] Filter by category and status, with sort and pagination
- [x] Duplicate SKU and barcode detection
- [x] Stock adjustment with mandatory reason, writing a movement
- [x] CSV import with per-row validation and an error report
- [x] CSV export
- [x] Deactivate instead of delete when referenced by transactions

### Phase 4 — Billing engine ⚑ core

- [x] Single calculation service; no tax maths in components
- [x] Tax-inclusive and tax-exclusive modes
- [x] Item and cart discounts, with configured ordering against tax
- [x] Zero-rated and non-taxable items
- [x] CGST/SGST vs IGST determination
- [x] Round-off line to nearest rupee
- [x] Decimal quantities honouring unit precision
- [x] **Unit tests before the UI**: inclusive, exclusive, discounts, rounding, decimal quantities, zero-rated
- [x] POS screen: search, barcode, cart, quantity, discounts, totals
- [x] Customer selection and walk-in default
- [x] Keyboard shortcuts
- [x] Hold and resume cart
- [x] Negative-stock policy enforced, configurable
- [x] **Atomic checkout**: sale, lines, payments and movements in one transaction
- [x] Invoice number allocated inside that transaction
- [x] Duplicate-submission guard
- [x] Rollback leaves no partial sale — tested by forced failure

### Phase 5 — Payments and receipts

- [x] Cash, UPI, card, bank transfer, other
- [x] Split payments reconciling to amount due
- [x] Cash change calculation
- [x] Payment records with method, amount, timestamp, reference
- [x] One invoice data model shared by preview, PDF and print
- [x] 58mm template
- [x] 80mm template
- [x] A4 invoice template
- [x] PDF export
- [x] Print preview
- [x] Printer selection and test print in Settings (built; unverified on real hardware)
- [x] Print failure never loses or duplicates a committed sale
- [x] Reprint from sales history

### Phase 6 — Sales history

- [x] Invoice list with pagination
- [x] Search by invoice number and customer
- [x] Date range, payment method and status filters
- [x] Invoice detail from the stored snapshot
- [x] Snapshot proven immutable: edit a product, old invoice unchanged
- [x] Void/cancel with reason, audit entry and stock reversal
- [x] No hard delete of completed sales

### Phase 7 — Inventory and returns

- [x] Movement ledger as the single source of stock truth
- [x] Balances derived from movements
- [x] Low-stock alerts against reorder level
- [x] Movement history per product
- [x] Returns against an original invoice
- [x] Partial returns, capped at original quantity
- [x] Return reason recorded
- [x] Restock only when the operator marks items resaleable
- [x] Tax reversal calculated correctly
- [x] Refund recorded against a payment method
- [x] Duplicate-return prevention
- [x] All of the above inside transactions

### Phase 8 — Customers and reports

- [x] Customer CRUD and search
- [x] Walk-in default customer
- [x] Purchase history per customer
- [x] Report: daily sales
- [x] Report: date-range sales
- [x] Report: product-wise
- [x] Report: category-wise
- [x] Report: payment-method summary
- [x] Report: tax summary
- [x] Report: discount summary
- [x] Report: returns
- [x] Report: stock on hand
- [x] Report: stock movement
- [x] Report: low stock
- [x] Estimated gross profit, labelled as an estimate
- [x] CSV export on every report
- [x] Consistent definitions across reports, documented

### Phase 9 — Backup, restore and audit

- [x] Manual backup using SQLite's backup API, WAL-safe
- [x] Scheduled automatic backup
- [x] Backup to a user-chosen directory, outside the database directory
- [x] Timestamp, app version and schema version in backup metadata
- [x] Integrity check on the produced file
- [x] Restore with confirmation and pre-restore safety copy
- [x] Restore validation and clear error messages
- [x] **Restore tested from a real backup into a clean install**
- [x] UI warning that a backup on the same disk is not protection against disk loss
- [x] Audit log for void, return, stock adjustment, settings change, restore
- [x] Audit log is append-only

### Phase 10 — Tests, packaging, documentation

- [x] Calculation tests: inclusive, exclusive, discount, rounding, decimal quantity
- [x] Payment tests: split, change, under/overpayment rejection
- [x] Transaction tests: rollback, duplicate submission, invoice uniqueness
- [x] Inventory tests: deduction, return restock, negative-stock policy
- [x] Migration test and backup/restore test
- [x] IPC validation tests for malformed input
- [x] Manual: launches with network disconnected
- [x] Manual: billing works offline
- [x] Manual: restart preserves sales
- [x] Manual: interrupted write leaves consistent data
- [x] Manual: printer failure neither loses nor duplicates a sale
- [x] electron-builder Linux packages: AppImage and .deb, with an icon and a
      desktop entry
- [x] Linux package installed and started on a clean home directory
- [x] Update does not overwrite user data — verified on Ubuntu: 0.1.1 installed
      over 0.1.0, shop, sale and stock ledger intact
- [ ] electron-builder NSIS installer with stable app id — configured, never built
- [ ] Installer verified on a clean Windows machine — **needs Windows**
- [ ] Dragging a sent PDF into WhatsApp Desktop — **needs Windows**
- [ ] Update does not overwrite user data on Windows — **needs Windows**
- [x] README: prerequisites, install, dev, test, package
- [x] Docs: database location, backup location, recovery procedure
- [x] Docs: known limitations and unsigned-installer implications
- [x] Docs: how to collect diagnostics without exposing customer data

### Phase 11 — Suppliers and purchases

- [x] Schema: suppliers, purchases, purchase_items, purchase_returns, purchase_return_items
- [x] Supplier CRUD, search, deactivate-not-delete
- [x] Purchase entry: supplier bill number, lines with cost, MRP, discount, GST
- [x] Stock IN through the movement ledger, never a typed balance
- [x] Product cost updated from the latest purchase; selling price only when asked
- [x] Purchase number is a local per-branch sequence, allocated inside the transaction
- [x] Purchase returns against a purchase, capped at what is still returnable
- [x] Supplier payments, and what is still owed to each supplier
- [x] Cancel a purchase with reversal, never a delete
- [x] Reports: purchases, purchase returns, supplier outstanding
- [x] Tests for every rule above

### Phase 12 — Double-entry ledger

- [x] Chart of accounts with groups, seeded on setup, extendable
- [x] `ledger_entries`: voucher, date, account, debit, credit, narration, reference
- [x] Every document posts a balanced voucher in its own transaction, or rolls back
- [x] Postings for cash/card/UPI/credit sales, returns, purchases, purchase returns,
      payments received and made, and discounts
- [x] Trial balance: debits equal credits, proven by test on generated data
- [x] Cash book, party ledgers, account statement
- [x] Opening balances for cash, customers and suppliers
- [x] A voucher is never edited; a correction is a reversing voucher

### Phase 13 — Users, roles and login

- [x] Password hashing (scrypt), first-run admin, forced change of a seeded password
- [x] Login screen, session in the main process, lock on idle
- [x] Roles: admin, manager, cashier, with a permission set per role
- [x] Permission checks in the IPC layer, not only in the UI
- [x] Every document already stores `operator_id`; show who did what in the audit trail
- [x] User management: create, deactivate, reset password
- [x] Approval for a void or a return above a threshold

### Phase 14 — Loyalty

- [x] Loyalty cards per customer, with tier, rate and expiry
- [x] Points earned on net amount, redeemed against a bill, both as transactions
- [x] Redemption capped at balance and at bill value
- [x] A sales return reverses the points the sale earned
- [x] Balance is derived from the transactions, never only cached
- [x] Points liability posted to the ledger
- [x] Points shown at the till and on the receipt

### Phase 15 — Batch and expiry

- [x] Batches per product with batch number, manufacture and expiry dates
- [x] Stock movements carry a batch, so a balance is per batch as well as per product
- [x] Purchase captures batch and expiry for products that track them
- [x] Selling picks the earliest expiry first, and refuses an expired batch
- [x] Returns go back to the batch they came from
- [x] Expiry report and a dashboard count of what expires within 30 days
- [x] Valuation: FIFO, LIFO or average, chosen per product

### Phase 16 — Trade terms and the counter

- [x] Price levels: retail, wholesale and special, chosen per customer or per bill
- [x] Credit sales, customer outstanding and a credit limit that blocks a sale
- [x] Payments received against a customer account, allocated to bills
- [x] Shift open and close, with a cash drawer count and a variance report
- [x] Barcode label printing for shelf and product labels
- [ ] Multi-branch stock — **not built**: every document already carries its
      branch, but a second branch needs stock transfers and two computers that
      agree on what happened, which is the sync problem v1 does not solve

---

### Phase 17 — Quotations

- [x] A quotation priced by the same engine as the till, so what is promised is
      what will be billed
- [x] Its own number series, never a number out of the invoice series
- [x] A validity date, after which it reads as expired without anything running
- [x] Printed as A4, saying in so many words that it is not an invoice
- [x] Billed in one tap: the till opens with the quoted lines and prices, and
      the sale points back at the quotation
- [x] Billed once only; cancelled with a reason; never edited, never deleted

---

---

## 4. Definition of done for v1.0

Ticked only where it has actually been observed, on this machine (Ubuntu)
unless stated. Ubuntu is the first shipping target; the remaining items need
Windows or a thermal printer.

- [x] Installs and starts on a clean **Ubuntu** machine — `.deb` and AppImage
      both run, database created at `~/.config/pos-desktop`
- [ ] Installs and starts on a clean Windows machine — **installer never built**
- [x] First-run setup completes — wizard run and inspected; Windows unverified
- [x] Products can be created, edited, searched, deactivated
- [x] A cashier completes a sale with no internet — billed inside an isolated
      network namespace with no interfaces at all
- [x] Totals and taxes verified by automated tests
- [x] Sale, payments and stock movements commit atomically
- [x] A committed sale survives restart — and a process killed mid-write
- [ ] Receipt preview plus one tested printer workflow — **no printer yet**;
      preview and a failed print are verified, a real print is not
- [x] A4 and PDF output work — A4 rendered and inspected, and PDF export has
      produced real files from the app on Linux (`SGS-1028.pdf`,
      `SGS-1030.pdf`, `SGS-QTN-0001.pdf` in his Documents). Unverified on
      Windows, like everything else there
- [x] Sales history and core reports work
- [x] Stock updates correctly on sale and return
- [x] Backup and restore tested end to end — including into a clean install
- [x] Automated tests pass — 337
- [x] No cloud service required — proven with no network available
- [x] README and recovery documentation complete
- [x] Data model ready for future multi-branch sync — UUIDs everywhere, branch
      scoping and a sync queue in the schema, unused in v1

---

## 5. Reuse from the existing cloud POS

`../POS` is a working React + Supabase POS. It stays deployable and serves as reference.

| Source                                                                                                          | Use                                                |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Billing, Products, Dashboard, Customers, Inventory, Reports, GST, Categories, Services, Settings, Backup, Audit | Port the UI; rewrite data calls and money handling |
| `src/lib/supabase.ts` types                                                                                     | Domain model reference for the SQLite schema       |
| Tailwind config, layout, icons                                                                                  | Carry over directly                                |
| jsPDF / xlsx export code                                                                                        | Carry over                                         |
| SaaS pages (companies, subscriptions, tenants, users, branches, gateways, employees, attendance, themes)        | Not ported                                         |

Roughly half the UI is reusable, but each ported page needs its `supabase.from()` calls
replaced with IPC service calls, money converted to integer paise, and multi-tenant
`company_id` scoping removed. The entire backend is new.

**Estimate:** 6–8 weeks full-time for v1.0 as scoped above. Phases 11 to 16 are the
functional specification of 13 October 2026 — purchases, a double-entry ledger, users
and roles, loyalty, batch and expiry, and trade terms — and are a second release of
comparable size, not a tail of small additions.

---

## 6. Known risks

| Risk                                      | Mitigation                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Thermal printing unreliable across models | Phase 0b spike on real hardware before feature work                            |
| `better-sqlite3` native rebuild friction  | Resolve in Phase 0; pin versions and commit the lockfile                       |
| Scope creep back toward the deferred list | Deferred items stay deferred until v1.0 ships                                  |
| Money rounding disputes                   | Documented strategy plus tests before any UI                                   |
| Data loss on a shop PC                    | Backup is a v1 feature, not an afterthought; external-copy warning in UI       |
| No update channel                         | Decide before release: manual installer distribution, or optional online check |

---

## 7. Open decisions

- [ ] Target thermal printer model for the Phase 0b spike
- [ ] Update distribution method for shipped installs
- [x] Whether Quotations is ported from the existing app — yes, Phase 17 built
      them, and `docs/quotations.md` describes them

---

## 7b. Known gaps

Small things the app does not do, each one noticed while building something
else. None of them blocks a release; they are written down so they are not
rediscovered as surprises.

- [x] **A UPI QR code on the bill.** Done: `src/shared/qr.ts` encodes one,
      verified against an independent encoder and read back by a scanner from
      the rendered page.
- [x] **A label sheet cannot be saved as a PDF.** Done: the dialog has Save
      PDF beside Print, through the same export the invoice uses.
- [x] **No purchase order.** Done: orders are their own document with their
      own series, printed or saved as a PDF, and received into a supplier's
      bill that marks them inside its own transaction. `docs/purchase-orders.md`.
- [x] **A bill can only be handed over, not sent.** Done: WhatsApp, from the
      bill, the quotation, the order and the customer's account.
      `docs/whatsapp.md` — including what WhatsApp does not allow any app to do.
- [ ] **Thermal receipts take no theme.** Deliberate for now: 58 or 80 mm of
      monochrome paper has nothing to dress, and the choices that do mean
      something there — the footer line, the tax breakdown — are already in
      Settings → Receipt. Revisit only if a shop asks.

---

## 8. Progress log

| Date       | Phase | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-12 | —     | Plan created. Pharmacy deferred. TypeScript confirmed. Project directory created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-12 | 0     | Foundation complete. Electron 44 + Vite 7 + React 18 + TS 5.9. Secure IPC verified end to end: `[boot] ipc ok — electron 44.7.0, journal wal, foreign_keys on, schema v0`. Lint, typecheck and 5 tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-10-12 | 1     | Database complete. 18 tables, 25 indexes, forward-only migrator, repository base with `inTransaction`. Money in paise, quantity in thousandths, stock as a movement ledger. 31 tests pass, covering rollback, FK enforcement, CHECK constraints and a write/read of every table. Entity repositories arrive with their feature phases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-12 | 2     | Settings and first-run wizard complete. Zod-validated settings in seven sections, 5-step wizard, Settings page with four tabs, logo picker copying into userData. Setup creates company, branch, operator, walk-in customer and both invoice sequences in one transaction. 57 tests. Currency is fixed to INR (the only one supported in v1); timezone defaults to Asia/Kolkata — both shown on the review step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-12 | 3     | Catalogue complete. Money as integer paise and quantity as integer thousandths, both parsed from strings to avoid float error. Products, categories, units, search/filter/sort/pagination, duplicate SKU and barcode detection, stock adjustment with mandatory reason, CSV import with per-row errors and CSV export that re-imports cleanly. 137 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-10-12 | 4     | Billing engine complete. Single calculation service in `src/shared/billing.ts`, rules documented in `docs/calculations.md`. 32 calculation tests written before any UI; 22 checkout tests. Atomic sale: header, lines, payments and stock movements in one transaction, invoice number allocated inside it so a failure burns no number. Idempotency key prevents double-charging. POS screen with barcode entry, price override, split payments, change, hold/resume and F2/F4/F8. 191 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-10-14 | —     | The gaps, closed. A UPI code on the bill, encoded here rather than fetched — `src/shared/qr.ts`, byte mode at level M, verified module for module against an independent encoder and read back by a scanner off the rendered page, after three bugs that produced plausible symbols no scanner could read. Shelf labels can be saved as a PDF, as every other document could. And purchase orders: migration 013, their own series (`SGS-PO-0001`), costs without tax because what is charged is the supplier's bill to say, overdue read from the date, printed or saved for emailing, and received into a purchase that marks the order inside the bill's own transaction so one order cannot be received twice. 577 tests. |
| 2026-10-14 | —     | Bill templates. A tax invoice must show what it must show, so the document is one piece of markup with a stylesheet over it: four designs — classic, modern, compact, bordered — and per-shop choices for the colour, the logo, the HSN and discount columns, the signature line, terms and payment details. A theme cannot leave out a column the law requires, which is the reason it is a stylesheet and not a layout each shop draws. Settings shows a live preview of a sample bill priced by the same engine as the till, so a shop compares documents it could really print; the quotation sheet takes the same theme, so a customer sees one shop rather than two. An earlier attempt at this went the other way — upload the printer's letterhead, find the paper in a photograph of it, straighten and whiten it like a document scanner, and lay the bill into the white space. It worked, and it was the wrong shape of answer: a shop expects to pick a design, not to photograph its stationery. It was removed rather than kept as an option. Quotations also gained the preview the till receipt always had, with Save PDF, so a shop with no printer can still hand over a price; a failed print now says "No printer is set up on this computer" rather than Chromium's "Failed to enumerate printers". Two things found by using it: the shop logo is always stored as `assets/logo.png`, so replacing one PNG with another left the path identical and the sidebar kept the old picture until a restart — it now re-reads whenever settings are saved; and the preview sat below the fold and re-rendered on every keystroke, so it read as the app being slow — it is fetched when the page opens, waits for a pause in typing, and sits beside the controls scaled to fit rather than under them at full size. Settings keeps its 820 px measure everywhere a shop is filling in fields, and drops it on this one tab, where what is being looked at is a sheet of paper. `docs/templates.md`. 550 tests. |
| 2026-10-14 | —     | WhatsApp. A bill, a quotation, an order to a supplier and a customer's statement of account can each be sent from the screen they live on: the sheet is rendered as a picture and as a PDF into Documents → POS Outbox, the picture goes on the clipboard, a window opens on the PDF with the file selected, and WhatsApp opens on the right number with the message already typed. The last keystroke is the shop's — a `wa.me` link carries text and nothing else, and no desktop program can attach a file to a chat from outside WhatsApp. The Business Cloud API that can was rejected: a Meta account, approved templates, a charge per conversation and the internet, against a product sold for one payment. Numbers are normalised rather than guessed at (`98765 43210`, `+91 98765-43210` and `098765 43210` all reach `919876543210`; anything unreadable is refused with the number shown back). The statement is drawn fresh from bills already issued and receipts already taken, carries a UPI code when something is owed, and says on its face that it is not a bill. Three channels, permission by document rather than by channel. 17 tests; all four kinds captured on screen. `docs/whatsapp.md`. |
| 2026-10-13 | 17    | Quotations. A price put in writing before anything is sold: no stock moves, no money is taken, nothing reaches the books, which is why it is its own document rather than a draft sale. Priced by `calculateBill`, the same engine as the till, and a test asserts the quotation and the till preview agree to the paisa. Its own series (`SGS-QTN-0001`) so a GST invoice series stays unbroken. Expiry is read from the date rather than stored, so a quotation cannot be stale in one place and open in another. Billing it opens the till with the quoted lines, the customer and their price list, and marks the quotation converted inside the sale's own transaction — a second bill against the same price is refused. Cancelled with a reason, never edited, and a trigger refuses a delete. 15 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-10-13 | 16    | Trade terms and the counter. Three price lists, with a level that falls back to retail when a shop has not set one; a customer brings their level to the till, and moving a bill to another list re-prices every line except the ones already typed over by hand. A bill may be left part-paid only against a named customer, inside their limit, and only when the shortfall is ticked — an underpaid bill with nothing ticked is a mistake and is refused as one. What a customer owes is derived from the documents and lands on their own line in the receivables control, so the counter and the books cannot disagree; money received posts a receipt voucher as it is written. A shift is opened with a float and closed with a count, and what the drawer should hold is computed from the session's own cash — takings net of change, less refunds and anything paid out — with the difference recorded and never corrected away. Shelf labels print on three sheet sizes with a Code 128 barcode encoded here rather than by a dependency, checked against hand-computed symbols, because a label that prints and does not scan is worse than none. Migration 011, three new reports, 504 tests. Verified in the running app: a wholesale bill of ₹898 part-paid with ₹498 left on account and the receivable to match, ₹200 taken against it, and a drawer closed ₹20 short. Multi-branch is left unbuilt, with the reason written down.                                                                                                                                                                                                                                              |
| 2026-10-13 | 15    | Batches and expiry, per product: a shop selling soap is never asked for an expiry date. A batch carries its number, its dates and the cost it actually arrived at, and its balance is the sum of the movements carrying it — the same ledger a product balance comes from, so the two cannot disagree. A supplier's bill asks for the batch on any line that needs one and refuses the line without it. The till takes the earliest expiry first, so one sale line can leave several movements; an expired batch is never sold, and the sale is refused rather than warned about. Returns and voids put goods back in the batch they came out of, because a packet returned today still expires when its own batch does. Expiring stock is a report, a tab on the Inventory screen and a count on the dashboard for the next month — the window a shop can still act in. Valuation is per product: a batched product is worth what its remaining batches cost, and everything else follows FIFO, LIFO or average over the arrivals that stated a cost. Migration 010. 477 tests. Verified in the running app: two batches of tea bought on real supplier bills, twelve units sold, and the till took all ten of the batch expiring first and two of the later one.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10-13 | 14    | Loyalty. A card per customer carrying its own tier, earning rate and expiry, so raising the shop's rate rewards new cards instead of rewriting what an old one promised. Points are earned on the taxable value — after discounts, before tax, because tax is not the shop's money — and spent as a discount, capped by the balance and by the share of a bill the shop allows, both worked out before the points are spent so spending cannot make room for itself. The balance is summed from the entries every time and never stored; the entries cannot be edited or deleted, and a correction is another entry with a reason. A void takes back everything a sale earned and returns what it spent; a return does the same in proportion to what came back. Points are a liability in the books — earning debits Loyalty points and credits Loyalty points owed, spending unwinds both, and a correction posts its own journal voucher, so a card and the trial balance cannot drift apart. Migration 009 adds the cards, the entries and what each sale moved, kept on the sale so a reprint shows what the customer was told at the counter. 453 tests. Verified in the running app: a card issued and carried over at 120 points, a ₹698 bill paid down to ₹578 with them, 10 points earned back, and the books showing exactly what is owed.                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-13 | 13    | Users, roles and login. Passwords are scrypt with their parameters stored beside the hash, compared in constant time, and never written anywhere else; a wrong name and a wrong password are refused in the same words, so the screen cannot be used to find out who works here. The session lives in the main process — not the renderer, which a bug could change, and not the database, where a crash would leave a till signed in — and it ends itself after the idle minutes the shop sets. Three roles with a permission set each, enforced by a gate every IPC channel passes through, so hiding a button is only a courtesy. A void or a return is checked differently: a role that covers it does it alone, and one that does not may still do a small one and needs a manager's password above the shop's threshold — asked for inside the dialog the cashier is already in, and it never signs them in. Migration 008 rebuilds the operators table for the third role and a forced password change, keeping every reference from sales, purchases, vouchers and the audit trail. Nobody can lock the shop out: login cannot be turned on without an owner who has a password, and the last such owner cannot be deactivated or demoted. 431 tests. Verified in the running app: signed in as a cashier, who saw three nav items instead of eleven, was stopped on a ₹499 void, and completed it with the manager's password — the audit trail reads void by Ravi, approved by Meena. Also fixed a screenshot patch that had leaked into the Phase 12 commit, where Settings opened on the Accounts tab.                                                                               |
| 2026-10-13 | 12    | Double-entry ledger. Migration 007 adds accounts, vouchers, ledger entries and voucher numbering, with triggers that refuse an update or a delete — a mistake is corrected by a reversing voucher, which is also how a void and a cancellation are recorded. Customers and suppliers share a control account each and are named on the entry, so the chart stays readable and a party still has its own statement. Every sale, credit note, purchase, debit note and supplier payment posts inside the transaction that writes the document, so the books cannot be half-written; an unbalanced voucher is refused before anything is written. Because documents are the source and the books are derived, posting is idempotent and catches up: `postMissing` runs at startup and accounted for the 23 documents the demo shop already had. Inventory is periodic — a purchase is an expense — which is the convention this size of shop keeps. Trial balance, cash book and day book as reports, a books panel in Settings with balances and a clickable account statement, a supplier's own account from the Suppliers page, and opening balances posted once. A shop also spends money no document here issues — rent, wages, electricity — so it can add its own accounts, numbered in a block clear of the seeded codes, and post a two-sided entry by hand; without that the books would know what came in and not what went out. 408 tests, including one that posts every kind of document and asserts the trial balance is zero. Verified on the demo database: debits and credits both ₹48,909.60, and what the books say a supplier is owed matches the Purchases page to the paisa. |
| 2026-10-13 | 11    | Suppliers and purchases. Migration 006 adds suppliers, purchases, purchase items, purchase returns, their items, supplier payments and a numbering table of our own — the invoice sequence is fixed to documents we issue. A supplier's bill runs through the same calculation engine the till uses, so tax, discounts and rounding behave identically in both directions; GST is added on top by default, because that is how a supplier bills. Stock arrives as a movement carrying its cost, the product's cost price follows the latest bill excluding reclaimable tax, and the selling price only moves when the operator ticks it. Returns to a supplier are capped at what is left on the line and settle as a debit note or as money back; cancelling a bill reverses exactly the stock it brought in and is refused once money or goods have moved. What a supplier is owed is derived from the documents, never stored. Three reports and 36 tests. Screens: purchases, suppliers, and a bill with its return and payment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-13 | 10d   | Cleared every build warning, and one of them was real. The Linux desktop entry hardcoded `StartupWMClass: Universal POS` while the running window reports `pos-desktop`, so a desktop environment could not tie the window to the launcher — checked with `xprop`, not assumed. Dropping the override and setting `desktopName` in package.json makes both read `pos-desktop`. The other two were noise: zod 4's `@__PURE__` annotations sit where Rollup cannot attach them, now filtered by code and path rather than silenced wholesale, and `@electron/rebuild` was a second copy of what electron-builder already bundles, so `npm run rebuild` is now `electron-builder install-app-deps` and the dependency is gone. A packaging run prints no warnings at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-13 | 10c   | Dashboard. The sidebar had carried a disabled "Dashboard — soon" item since Phase 0, which is not something to ship. It is now a real screen: today's takings net of returns, the last seven days, the average bill, what each payment method has taken net of change given, the five products closest to their reorder level, and the last ten bills with the voided ones greyed. It composes the repositories the reports already use rather than adding a second definition of a day's takings — with a test asserting it reports the same net figure as the sales summary report for the same day. 345 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-13 | 10b   | Ubuntu packaging. AppImage and `.deb` built with an icon, a desktop entry and Electron's runtime dependencies declared. The package was installed on a clean home directory and started into the setup wizard, creating its database at `~/.config/pos-desktop` with all five migrations applied; then 0.1.1 was installed over 0.1.0 and the shop, its sale and the stock ledger were all still there, with the app going straight to the till rather than the wizard. The AppImage runs from the same data folder, so a shop can move between the two. The packaged build now ships a trimmed menu — Electron's default offered Reload and Toggle Developer Tools to a cashier. README and `docs/operations.md` cover installing, upgrading and removing on Ubuntu, and that an unsigned local `.deb` installs with no warning at all, which is its own risk. Version 0.1.1. Windows packaging is still unbuilt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10-13 | 10    | Tests and documentation complete; packaging is not. The validation gate moved out of the IPC registry into its own module so it can be tested without Electron, and every channel is now driven with hostile payloads — wrong types, prototype pollution, SQL in an id field, fractional paise, unsupported payment methods — with assertions that undeclared fields never reach a handler. A new crash test kills a child process mid-transaction and proves the next start finds the whole sale or none of it, with the ledger intact and no invoice number burned. The four runnable manual checks were done in the real app inside an isolated network namespace with no interfaces at all: it launched, billed SGS-1015, failed to print to a bogus printer without losing or duplicating the sale, and still had it after a restart. README rewritten for what v1 actually does, and `docs/operations.md` written for the shop: where data lives, how to back up and restore, what to do when it will not start, what to send when reporting a problem, and what an unsigned installer means. 337 tests. **Not done: the Windows installer has never been built or installed, and update-preserves-data is unproven — both need a Windows machine.**                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-13 | 9     | Backup, restore and audit complete. Backups go through SQLite's backup API, so a sale still in the WAL is in the file; each one is verified after writing (integrity check, schema version, row count against the source), stamped with app and schema version inside the file, and folded to a single file with no stray `-wal`. A folder inside the app's own data is refused. Automatic daily or weekly backups run from a scheduler that catches up after a day the shop was shut, with retention pruning only our own files. Restore validates first, takes a pre-restore copy, clears the stale WAL, reopens and migrates forward, and writes an audit entry. Audit trail screen in Settings; migration 005 makes `audit_logs` append-only at the database. 320 tests, including a restore from a real backup into a clean install. Two real bugs found by running the app: a partial settings patch reset the rest of its section to defaults (Zod reapplies defaults on a partial schema), and settings written before this phase failed to load at all because the new section was absent — the app would not start after an update. Both fixed with regression tests. Backup, restore and the audit trail were exercised end to end in the running app.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-13 | 8     | Customers and reports complete. Customers: list with spend and last purchase, create/edit, deactivate (never delete, and never the walk-in row), purchase history per customer. Eleven reports behind one screen — sales summary, daily sales, product-wise, category-wise, payment methods, tax summary, discounts, returns, stock on hand, stock movement, low stock — all returning the same table shape, so one renderer and one CSV writer serve every one and an export cannot disagree with the screen. Cash is reported net of change given; the tax summary is net of credit notes; estimated gross profit is net of returns and computed from one shared per-product basis, so the summary and the product report agree. Definitions written down in `docs/reports.md`. 293 tests. Screens captured and inspected: sales summary, product-wise, customers, customer history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-13 | 7     | Inventory and returns complete. Inventory screen over the ledger: stock list, low-stock alert against the reorder level, and per-product movement history with a running balance that names the invoice or credit note behind each move. Returns are credit notes against one invoice: partial quantities capped at what is still returnable, value reversed from the stored line so successive partials credit the line exactly, CGST/SGST/IGST reversed under the heads the invoice charged, refund written as a negative payment, restock only when the operator marks goods resaleable, and an idempotency key against a double submit. Voiding a sale that has a credit note is refused, so stock cannot come back twice. Migration 004 adds the return tax split, the idempotency key and delete protection. 264 tests. Screens captured and inspected: inventory, movement history, return dialog, a returned invoice, and a real return taken end to end through the running app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-10-13 | 6     | Sales history complete. Invoice list with search (number, customer, phone), local-day date range, payment-method and status filters, pagination, and totals for the whole filtered set rather than the page. Detail reads the stored snapshot — proven by editing a product and re-reading the invoice. Void writes status, reason, reversal movements and an audit row in one transaction; a voided invoice keeps its number, drops out of the takings and prints marked VOIDED. Migration 003 blocks deletes on sales, sale_items and payments at the database. 235 tests. Screens captured and inspected: list, detail, voided detail, void dialog, voided reprint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-12 | 5     | Receipts complete. One `buildReceiptHtml` drives preview, PDF and print, so totals cannot diverge. 58mm, 80mm and A4 templates rendered and inspected; HTML escaped against names containing `&` or markup. Printer enumeration, selection and test page built. Fixed a presentation bug where a discount read as subtracted twice. 208 tests. **Printing is unverified on real hardware** — Phase 0b still open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
