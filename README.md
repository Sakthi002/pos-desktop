# Universal POS

Offline-first desktop point-of-sale and billing software for retail shops.

Built for **one shop on one Windows computer**. There is no cloud service, no
subscription, no login server and no external API. Everything — products,
sales, stock, customers — is stored in a local SQLite database on that machine,
and the application works with the network disconnected.

Suitable for grocery and general stores, supermarkets, textile and clothing
shops, hardware and electrical, electronics and stationery. Pharmacies are out
of scope for v1, because they need batch and expiry tracking.

> **Status: feature-complete for v1; shipping on Ubuntu first.** Setup,
> catalogue, billing, receipts, sales history, returns, inventory, customers,
> reports, backup and restore all work and are covered by tests. The Linux
> packages are built, installed and upgraded in place with the shop's data
> intact. Still open: the Windows installer has never been built, and printing
> has **not** been verified on real thermal hardware. See [PLAN.md](PLAN.md)
> for the checklist.

## What it does

| Area      | What is there                                                                      |
| --------- | ---------------------------------------------------------------------------------- |
| Dashboard | Today's takings, what is in the till, running low, recent bills                    |
| Setup     | First-run wizard: shop profile, GST, invoice numbering, receipt size               |
| Catalogue | Products, categories, units, CSV import/export, stock adjustment with a reason     |
| Billing   | Barcode and search, discounts, split payments, change, hold and resume, shortcuts  |
| Receipts  | 58mm, 80mm and A4 from one model; preview, PDF, reprint                            |
| Sales     | History with search and filters, invoice detail from the stored snapshot, void     |
| Returns   | Credit notes against an invoice, partial, tax reversed, restock only if resaleable |
| Inventory | Movement ledger, running balances, low-stock alerts, per-product history           |
| Customers | Named customers and walk-in, purchase history                                      |
| Purchases | Supplier bills through the same tax engine, returns, payments, what is owed        |
| Books     | Double-entry ledger posted automatically, trial balance, cash book, day book       |
| Reports   | Seventeen reports, every one exporting to CSV; definitions in `docs/reports.md`    |
| Safety    | Verified backups, restore with a pre-restore copy, append-only audit trail         |

## Stack

Electron · React · TypeScript · Vite · SQLite (`better-sqlite3`) · Vitest

```
src/renderer   React UI. Calls window.api only.
src/preload    contextBridge. Exposes exactly one function: invoke().
src/main       Electron main: window, IPC handlers, services, SQLite.
src/shared     Types, the IPC contract, and the bill calculation.
```

The renderer never opens the database, runs SQL or touches the filesystem.
Every IPC channel is declared with a Zod schema and validated before a handler
runs. See [CLAUDE.md](CLAUDE.md) for the rules this codebase follows.

## Prerequisites

- Node.js 22 or newer
- On Windows, the build tools needed to compile `better-sqlite3`
  (Visual Studio Build Tools with the C++ workload)

## Getting started

```bash
npm install
npm run dev
```

On first launch a setup wizard collects the shop name, address, GST details,
invoice numbering and receipt size. Nothing is sent anywhere.

## Commands

| Command               | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Electron + Vite with hot reload             |
| `npm run build`       | Typecheck, then build all three processes   |
| `npm run typecheck`   | `tsc --noEmit` for node and web configs     |
| `npm run lint`        | ESLint                                      |
| `npm test`            | Vitest                                      |
| `npm run format`      | Prettier                                    |
| `npm run rebuild`     | Rebuild `better-sqlite3` for Electron's ABI |
| `npm run package:win` | Windows installer into `release/`           |

After changing the Electron or Node version, run `npm run rebuild` or
`better-sqlite3` will fail to load with an ABI mismatch. That script now calls
`electron-builder install-app-deps`, the same rebuild packaging does, so there
is one code path rather than two.

## Installing on Ubuntu

Download the `.deb` and install it:

```bash
sudo apt install ./Universal\ POS-0.1.1-amd64.deb
```

It appears in the applications menu as **Universal POS**. Upgrading means
installing the newer `.deb` over it; the shop's data is untouched. Removing the
package (`sudo apt remove pos-desktop`) leaves the database in place.

There is also a portable `.AppImage` that needs no installation:

```bash
chmod +x Universal\ POS-0.1.1-x86_64.AppImage
./Universal\ POS-0.1.1-x86_64.AppImage
```

Both use the same data folder, so a shop can try the AppImage and install the
package later without losing anything.

## Packaging a release

```bash
npm run package:linux    # AppImage + .deb into release/
npm run package:win      # NSIS installer into release/ (needs Windows or Wine)
```

The Linux artifacts are built and tested. The Windows installer has never been
produced on this machine.

The application id is `in.vinuva.pos` and must never change: it is what ties an
installation to its data folder. On Windows, `deleteAppDataOnUninstall` stays
`false`, so uninstalling never takes a shop's database with it.

Neither package is signed. See
[docs/operations.md](docs/operations.md#the-packages-are-not-signed) for what
that means for the shop.

## Where your data lives

The database is kept in Electron's per-user data directory, never the install
directory, so updating the application cannot overwrite a shop's data.

| Platform | Path                                               |
| -------- | -------------------------------------------------- |
| Windows  | `%APPDATA%\pos-desktop\pos.db`                     |
| Linux    | `~/.config/pos-desktop/pos.db`                     |
| macOS    | `~/Library/Application Support/pos-desktop/pos.db` |

The packaged Linux build writes to exactly that path — verified by installing
the `.deb` on a clean home directory.

Uploaded logos sit alongside it under `assets/`, and copies taken automatically
before a restore under `pre-restore/`.

SQLite runs in WAL mode, so `pos.db` is accompanied by `pos.db-wal` and
`pos.db-shm`. **Copying `pos.db` alone can miss recent writes.** Use the
application's backup feature rather than copying the file by hand.

## Backup, restore and recovery

Settings → **Backup & restore** writes a verified, self-contained backup through
SQLite's backup API and can run daily or weekly on its own. Restoring validates
the file first and copies the live database before replacing it.

The full operational guide — where everything lives, how to recover, what to
send when reporting a problem — is in
[docs/operations.md](docs/operations.md).

## Money and quantities

Every amount is stored as an integer number of **paise**, and every quantity as
integer **thousandths**. No financial value is ever a JavaScript float, and
operator input is parsed from the string rather than multiplied, because
`1.005 * 100` is `100.49999999999999` and rounds the wrong way.

The rules for tax, discounts and rounding are documented in
[docs/calculations.md](docs/calculations.md) and are implemented in exactly one
place, which the screen, the stored sale and the printed receipt all call.
Report definitions — what counts as a sale, how returns are netted, what the
profit estimate assumes — are in [docs/reports.md](docs/reports.md).

## Tests

```bash
npm test
```

Covers the calculation rules, payments and change, atomic checkout and
rollback, duplicate submission, invoice numbering, the stock ledger, returns
and tax reversal, reports, migrations, backup and restore from a real backup
into a clean install, IPC payload validation, and recovery from a process
killed mid-write.

## Known limitations

- **The Windows installer has not been built or tested.** Ubuntu is the first
  target; on Windows, everything below the application layer — install,
  upgrade, uninstall — is unproven.
- **The packages are unsigned.** On Windows, SmartScreen will warn on first
  run; see [docs/operations.md](docs/operations.md#the-packages-are-not-signed).
- **Printing is unverified on real hardware.** Silent printing is off by
  default and is not supported by every printer or driver. Run a test page from
  Settings before relying on it.
- **One computer.** Multiple tills on a network are not supported yet.
- **No cloud sync.** The data model carries UUIDs and a sync queue so it can be
  added later without reshaping the transaction tables.
- **Not a statement of GST compliance.** The software computes and presents GST
  figures, but invoice formats, credit notes, rounding and record-retention
  rules must be verified against current regulations before commercial use.
- **Local data is not protected from a computer administrator.** Anyone with
  full access to the machine can read the database file.

## Backups

Keep a copy on a **separate** USB drive or external disk. A backup sitting on
the same disk as the database is lost with that disk.

## Licence

Proprietary. All rights reserved.
