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
- [ ] Update does not overwrite user data on Windows — **needs Windows**
- [x] README: prerequisites, install, dev, test, package
- [x] Docs: database location, backup location, recovery procedure
- [x] Docs: known limitations and unsigned-installer implications
- [x] Docs: how to collect diagnostics without exposing customer data

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
- [ ] A4 and PDF output work — A4 rendered and inspected; **PDF export has
      never actually produced a file**, because it needs a save dialog
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

**Estimate:** 6–8 weeks full-time for v1.0 as scoped above.

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
- [ ] Whether Quotations is ported from the existing app (currently out of scope)

---

## 8. Progress log

| Date       | Phase | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | —     | Plan created. Pharmacy deferred. TypeScript confirmed. Project directory created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-12 | 0     | Foundation complete. Electron 44 + Vite 7 + React 18 + TS 5.9. Secure IPC verified end to end: `[boot] ipc ok — electron 44.7.0, journal wal, foreign_keys on, schema v0`. Lint, typecheck and 5 tests pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10-12 | 1     | Database complete. 18 tables, 25 indexes, forward-only migrator, repository base with `inTransaction`. Money in paise, quantity in thousandths, stock as a movement ledger. 31 tests pass, covering rollback, FK enforcement, CHECK constraints and a write/read of every table. Entity repositories arrive with their feature phases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-12 | 2     | Settings and first-run wizard complete. Zod-validated settings in seven sections, 5-step wizard, Settings page with four tabs, logo picker copying into userData. Setup creates company, branch, operator, walk-in customer and both invoice sequences in one transaction. 57 tests. Currency is fixed to INR (the only one supported in v1); timezone defaults to Asia/Kolkata — both shown on the review step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-10-12 | 3     | Catalogue complete. Money as integer paise and quantity as integer thousandths, both parsed from strings to avoid float error. Products, categories, units, search/filter/sort/pagination, duplicate SKU and barcode detection, stock adjustment with mandatory reason, CSV import with per-row errors and CSV export that re-imports cleanly. 137 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-12 | 4     | Billing engine complete. Single calculation service in `src/shared/billing.ts`, rules documented in `docs/calculations.md`. 32 calculation tests written before any UI; 22 checkout tests. Atomic sale: header, lines, payments and stock movements in one transaction, invoice number allocated inside it so a failure burns no number. Idempotency key prevents double-charging. POS screen with barcode entry, price override, split payments, change, hold/resume and F2/F4/F8. 191 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-13 | 10c   | Dashboard. The sidebar had carried a disabled "Dashboard — soon" item since Phase 0, which is not something to ship. It is now a real screen: today's takings net of returns, the last seven days, the average bill, what each payment method has taken net of change given, the five products closest to their reorder level, and the last ten bills with the voided ones greyed. It composes the repositories the reports already use rather than adding a second definition of a day's takings — with a test asserting it reports the same net figure as the sales summary report for the same day. 345 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-13 | 10b   | Ubuntu packaging. AppImage and `.deb` built with an icon, a desktop entry and Electron's runtime dependencies declared. The package was installed on a clean home directory and started into the setup wizard, creating its database at `~/.config/pos-desktop` with all five migrations applied; then 0.1.1 was installed over 0.1.0 and the shop, its sale and the stock ledger were all still there, with the app going straight to the till rather than the wizard. The AppImage runs from the same data folder, so a shop can move between the two. The packaged build now ships a trimmed menu — Electron's default offered Reload and Toggle Developer Tools to a cashier. README and `docs/operations.md` cover installing, upgrading and removing on Ubuntu, and that an unsigned local `.deb` installs with no warning at all, which is its own risk. Version 0.1.1. Windows packaging is still unbuilt.                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-13 | 10    | Tests and documentation complete; packaging is not. The validation gate moved out of the IPC registry into its own module so it can be tested without Electron, and every channel is now driven with hostile payloads — wrong types, prototype pollution, SQL in an id field, fractional paise, unsupported payment methods — with assertions that undeclared fields never reach a handler. A new crash test kills a child process mid-transaction and proves the next start finds the whole sale or none of it, with the ledger intact and no invoice number burned. The four runnable manual checks were done in the real app inside an isolated network namespace with no interfaces at all: it launched, billed SGS-1015, failed to print to a bogus printer without losing or duplicating the sale, and still had it after a restart. README rewritten for what v1 actually does, and `docs/operations.md` written for the shop: where data lives, how to back up and restore, what to do when it will not start, what to send when reporting a problem, and what an unsigned installer means. 337 tests. **Not done: the Windows installer has never been built or installed, and update-preserves-data is unproven — both need a Windows machine.**        |
| 2026-10-13 | 9     | Backup, restore and audit complete. Backups go through SQLite's backup API, so a sale still in the WAL is in the file; each one is verified after writing (integrity check, schema version, row count against the source), stamped with app and schema version inside the file, and folded to a single file with no stray `-wal`. A folder inside the app's own data is refused. Automatic daily or weekly backups run from a scheduler that catches up after a day the shop was shut, with retention pruning only our own files. Restore validates first, takes a pre-restore copy, clears the stale WAL, reopens and migrates forward, and writes an audit entry. Audit trail screen in Settings; migration 005 makes `audit_logs` append-only at the database. 320 tests, including a restore from a real backup into a clean install. Two real bugs found by running the app: a partial settings patch reset the rest of its section to defaults (Zod reapplies defaults on a partial schema), and settings written before this phase failed to load at all because the new section was absent — the app would not start after an update. Both fixed with regression tests. Backup, restore and the audit trail were exercised end to end in the running app. |
| 2026-10-13 | 8     | Customers and reports complete. Customers: list with spend and last purchase, create/edit, deactivate (never delete, and never the walk-in row), purchase history per customer. Eleven reports behind one screen — sales summary, daily sales, product-wise, category-wise, payment methods, tax summary, discounts, returns, stock on hand, stock movement, low stock — all returning the same table shape, so one renderer and one CSV writer serve every one and an export cannot disagree with the screen. Cash is reported net of change given; the tax summary is net of credit notes; estimated gross profit is net of returns and computed from one shared per-product basis, so the summary and the product report agree. Definitions written down in `docs/reports.md`. 293 tests. Screens captured and inspected: sales summary, product-wise, customers, customer history.                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-13 | 7     | Inventory and returns complete. Inventory screen over the ledger: stock list, low-stock alert against the reorder level, and per-product movement history with a running balance that names the invoice or credit note behind each move. Returns are credit notes against one invoice: partial quantities capped at what is still returnable, value reversed from the stored line so successive partials credit the line exactly, CGST/SGST/IGST reversed under the heads the invoice charged, refund written as a negative payment, restock only when the operator marks goods resaleable, and an idempotency key against a double submit. Voiding a sale that has a credit note is refused, so stock cannot come back twice. Migration 004 adds the return tax split, the idempotency key and delete protection. 264 tests. Screens captured and inspected: inventory, movement history, return dialog, a returned invoice, and a real return taken end to end through the running app.                                                                                                                                                                                                                                                                         |
| 2026-10-13 | 6     | Sales history complete. Invoice list with search (number, customer, phone), local-day date range, payment-method and status filters, pagination, and totals for the whole filtered set rather than the page. Detail reads the stored snapshot — proven by editing a product and re-reading the invoice. Void writes status, reason, reversal movements and an audit row in one transaction; a voided invoice keeps its number, drops out of the takings and prints marked VOIDED. Migration 003 blocks deletes on sales, sale_items and payments at the database. 235 tests. Screens captured and inspected: list, detail, voided detail, void dialog, voided reprint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-12 | 5     | Receipts complete. One `buildReceiptHtml` drives preview, PDF and print, so totals cannot diverge. 58mm, 80mm and A4 templates rendered and inspected; HTML escaped against names containing `&` or markup. Printer enumeration, selection and test page built. Fixed a presentation bug where a discount read as subtracted twice. 208 tests. **Printing is unverified on real hardware** — Phase 0b still open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
