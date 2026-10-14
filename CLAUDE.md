# CLAUDE.md — Universal POS

Offline-first desktop POS. Electron + React + TypeScript + SQLite.
One shop, one Windows computer, no internet required.

See `PLAN.md` for scope and the phase checklist. Tick items there only when
completed **and verified**.

## Commands

| Command               | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Electron + Vite with HMR                    |
| `npm run dev:root`    | The same, for a shell running as root       |
| `npm run build`       | Typecheck, then build all three processes   |
| `npm run typecheck`   | `tsc --noEmit` for node and web configs     |
| `npm run lint`        | ESLint                                      |
| `npm test`            | Vitest                                      |
| `npm run rebuild`     | Rebuild `better-sqlite3` for Electron's ABI |
| `npm run package:win` | Windows NSIS installer into `release/`      |

After changing Electron or Node versions, run `npm run rebuild` or
`better-sqlite3` will fail to load with an ABI mismatch. `npm test` wants the
Node build, the app wants the Electron one; whichever ran last wins.

## Architecture

```
src/renderer   React UI. Calls window.api only.
src/preload    contextBridge. Exposes exactly one function: invoke().
src/main       Electron main: window, IPC handlers, services, SQLite.
src/shared     Types and the IPC contract, imported by both sides.
```

Data flows one way: renderer → `window.api.invoke` → validated IPC → service →
repository → SQLite. Nothing short-circuits it.

## Rules

**The renderer never touches Node.** No `fs`, no `electron`, no SQL, no
`child_process`. ESLint enforces this with `no-restricted-imports`. If the UI
needs something new, add a channel to the contract — that is the only route in.

**Every IPC channel is declared in `src/shared/ipc-contract.ts`** with a Zod
schema for its payload. `registerHandler` parses before the handler runs, so a
handler never sees an unvalidated shape. Adding a channel means editing the
contract first.

**Handlers never throw across the bridge.** They return
`{ ok: true, data }` or `{ ok: false, error }`. Internal errors are logged in
main and returned as a generic message — paths and SQL must not reach the
renderer.

**Money is integer paise. Quantity is integer thousandths.** No floating point
in any financial path. Formatting to rupees happens at the display edge only.

**Stock changes only through movements.** Never write a stock balance directly;
insert a movement and derive the balance. Sales, returns and adjustments all go
through the ledger.

**Multi-statement writes run in a transaction.** A sale writes its header,
lines, payments and stock movements atomically or not at all.

**Soft-deactivate, don't delete**, anything a transaction references. Products
go inactive; completed sales are never deleted.

**UUIDs on every syncable entity** from creation, even though v1 never syncs.
Invoice numbers are a local per-branch sequence and are not globally unique.

## Database

- Lives in Electron `userData`, never the install directory, so updates cannot
  destroy a shop's data.
- WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`.
- Schema changes are forward-only migrations; never edit an applied migration.
- Backups must use SQLite's backup API, not a file copy — a copy can miss
  uncheckpointed WAL data. Every backup is verified after writing and carries
  its app and schema version inside the file.
- `audit_logs` is append-only, enforced by triggers. Correct a mistake with
  another entry, never by editing one.

## Conventions

- TypeScript strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- Business logic lives in `src/main/services`, not in React components.
- Repositories are the only code writing SQL, always parameterised.
- Comments explain _why_, not _what_.

## State

Phases 0-9 complete, Phase 10 except Windows packaging, and phases 11 to 17:
foundation, schema, settings and setup, catalogue, billing, receipts, sales
history, inventory and returns, customers and reports, backup and audit, tests
and documentation, suppliers and purchases, the double-entry ledger, users with
roles and login, loyalty points, batches with expiry, trade terms with the
cash drawer, and quotations. Multi-branch is deliberately not built; `docs/trade.md` says why.

The ledger posts itself from the documents — a sale, a credit note, a purchase,
a debit note, a supplier payment — inside the same transaction that writes the
document. Posting is idempotent and `postMissing()` catches up at startup, so
the books are derived and can always be rebuilt from the documents. A voucher is
never edited; a correction is a reversing voucher.

A document can also be sent rather than handed over: a bill, a quotation, an
order or a statement of account is rendered to a picture and a PDF, and
WhatsApp is opened on the number with the message typed. The app sends
nothing itself — a `wa.me` link carries text and nothing else — and the paid
Business API was rejected for a product sold for one payment. See
`docs/whatsapp.md`.

Two things block a release, both needing hardware this machine does not have:
the Windows installer has never been built or installed, and printing is
unverified on a real thermal printer (Phase 0b). Dragging a sent PDF into
WhatsApp Desktop is unproved for the same reason. See `PLAN.md`.

`docs/README.md` is the way into the documentation: the whole app in
`docs/architecture.md`, every path through it in `docs/flows.md`, where each
feature lives in `docs/modules.md`, and how to show it to a shop in
`docs/demo.md`. Beside those, the feature records — report definitions in
`docs/reports.md`, calculation rules in `docs/calculations.md`, who may do
what in `docs/users.md`, points in `docs/loyalty.md`, batches and expiry in
`docs/batches.md`, price levels, credit and the drawer in `docs/trade.md`, a
price given before a sale in `docs/quotations.md`, what a shop asks a supplier
for in `docs/purchase-orders.md`, how a bill is dressed in
`docs/templates.md`, how one reaches a customer's phone in `docs/whatsapp.md`,
and what a shop needs when something goes wrong in `docs/operations.md`.
