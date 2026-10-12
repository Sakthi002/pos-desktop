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

- [ ] Invoice list with pagination
- [ ] Search by invoice number and customer
- [ ] Date range, payment method and status filters
- [ ] Invoice detail from the stored snapshot
- [ ] Snapshot proven immutable: edit a product, old invoice unchanged
- [ ] Void/cancel with reason, audit entry and stock reversal
- [ ] No hard delete of completed sales

### Phase 7 — Inventory and returns

- [ ] Movement ledger as the single source of stock truth
- [ ] Balances derived from movements
- [ ] Low-stock alerts against reorder level
- [ ] Movement history per product
- [ ] Returns against an original invoice
- [ ] Partial returns, capped at original quantity
- [ ] Return reason recorded
- [ ] Restock only when the operator marks items resaleable
- [ ] Tax reversal calculated correctly
- [ ] Refund recorded against a payment method
- [ ] Duplicate-return prevention
- [ ] All of the above inside transactions

### Phase 8 — Customers and reports

- [ ] Customer CRUD and search
- [ ] Walk-in default customer
- [ ] Purchase history per customer
- [ ] Report: daily sales
- [ ] Report: date-range sales
- [ ] Report: product-wise
- [ ] Report: category-wise
- [ ] Report: payment-method summary
- [ ] Report: tax summary
- [ ] Report: discount summary
- [ ] Report: returns
- [ ] Report: stock on hand
- [ ] Report: stock movement
- [ ] Report: low stock
- [ ] Estimated gross profit, labelled as an estimate
- [ ] CSV export on every report
- [ ] Consistent definitions across reports, documented

### Phase 9 — Backup, restore and audit

- [ ] Manual backup using SQLite's backup API, WAL-safe
- [ ] Scheduled automatic backup
- [ ] Backup to a user-chosen directory, outside the database directory
- [ ] Timestamp, app version and schema version in backup metadata
- [ ] Integrity check on the produced file
- [ ] Restore with confirmation and pre-restore safety copy
- [ ] Restore validation and clear error messages
- [ ] **Restore tested from a real backup into a clean install**
- [ ] UI warning that a backup on the same disk is not protection against disk loss
- [ ] Audit log for void, return, stock adjustment, settings change, restore
- [ ] Audit log is append-only

### Phase 10 — Tests, packaging, documentation

- [ ] Calculation tests: inclusive, exclusive, discount, rounding, decimal quantity
- [ ] Payment tests: split, change, under/overpayment rejection
- [ ] Transaction tests: rollback, duplicate submission, invoice uniqueness
- [ ] Inventory tests: deduction, return restock, negative-stock policy
- [ ] Migration test and backup/restore test
- [ ] IPC validation tests for malformed input
- [ ] Manual: launches with network disconnected
- [ ] Manual: billing works offline
- [ ] Manual: restart preserves sales
- [ ] Manual: interrupted write leaves consistent data
- [ ] Manual: printer failure neither loses nor duplicates a sale
- [ ] electron-builder NSIS installer with stable app id
- [ ] Installer verified on a clean Windows machine
- [ ] Update does not overwrite user data
- [ ] README: prerequisites, install, dev, test, package
- [ ] Docs: database location, backup location, recovery procedure
- [ ] Docs: known limitations and unsigned-installer implications
- [ ] Docs: how to collect diagnostics without exposing customer data

---

## 4. Definition of done for v1.0

- [ ] Installs and starts on a clean Windows machine
- [ ] First-run setup completes
- [ ] Products can be created, edited, searched, deactivated
- [ ] A cashier completes a sale with no internet
- [ ] Totals and taxes verified by automated tests
- [ ] Sale, payments and stock movements commit atomically
- [ ] A committed sale survives restart
- [ ] Receipt preview plus one tested printer workflow
- [ ] A4 and PDF output work
- [ ] Sales history and core reports work
- [ ] Stock updates correctly on sale and return
- [ ] Backup and restore tested end to end
- [ ] Automated tests pass
- [ ] No cloud service required
- [ ] README and recovery documentation complete
- [ ] Data model ready for future multi-branch sync

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

| Date       | Phase | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | —     | Plan created. Pharmacy deferred. TypeScript confirmed. Project directory created.                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-12 | 0     | Foundation complete. Electron 44 + Vite 7 + React 18 + TS 5.9. Secure IPC verified end to end: `[boot] ipc ok — electron 44.7.0, journal wal, foreign_keys on, schema v0`. Lint, typecheck and 5 tests pass.                                                                                                                                                                                                                                                                                   |
| 2026-10-12 | 1     | Database complete. 18 tables, 25 indexes, forward-only migrator, repository base with `inTransaction`. Money in paise, quantity in thousandths, stock as a movement ledger. 31 tests pass, covering rollback, FK enforcement, CHECK constraints and a write/read of every table. Entity repositories arrive with their feature phases.                                                                                                                                                         |
| 2026-10-12 | 2     | Settings and first-run wizard complete. Zod-validated settings in seven sections, 5-step wizard, Settings page with four tabs, logo picker copying into userData. Setup creates company, branch, operator, walk-in customer and both invoice sequences in one transaction. 57 tests. Currency is fixed to INR (the only one supported in v1); timezone defaults to Asia/Kolkata — both shown on the review step.                                                                               |
| 2026-10-12 | 3     | Catalogue complete. Money as integer paise and quantity as integer thousandths, both parsed from strings to avoid float error. Products, categories, units, search/filter/sort/pagination, duplicate SKU and barcode detection, stock adjustment with mandatory reason, CSV import with per-row errors and CSV export that re-imports cleanly. 137 tests.                                                                                                                                      |
| 2026-10-12 | 4     | Billing engine complete. Single calculation service in `src/shared/billing.ts`, rules documented in `docs/calculations.md`. 32 calculation tests written before any UI; 22 checkout tests. Atomic sale: header, lines, payments and stock movements in one transaction, invoice number allocated inside it so a failure burns no number. Idempotency key prevents double-charging. POS screen with barcode entry, price override, split payments, change, hold/resume and F2/F4/F8. 191 tests. |
| 2026-10-12 | 5     | Receipts complete. One `buildReceiptHtml` drives preview, PDF and print, so totals cannot diverge. 58mm, 80mm and A4 templates rendered and inspected; HTML escaped against names containing `&` or markup. Printer enumeration, selection and test page built. Fixed a presentation bug where a discount read as subtracted twice. 208 tests. **Printing is unverified on real hardware** — Phase 0b still open.                                                                              |
