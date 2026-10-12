# Universal POS

Offline-first desktop point-of-sale and billing software for retail shops.

Built for **one shop on one Windows computer**. There is no cloud service, no
subscription, no login server and no external API. Everything — products,
sales, stock, customers — is stored in a local SQLite database on that machine,
and the application works with the network disconnected.

Suitable for grocery and general stores, supermarkets, textile and clothing
shops, hardware and electrical, electronics and stationery. Pharmacies are out
of scope for v1, because they need batch and expiry tracking.

> **Status: in development.** See [PLAN.md](PLAN.md) for the phase checklist and
> what is done. Billing, products and receipts work; sales history, returns,
> reports and backup are not finished yet. Printing has **not** been verified on
> real thermal hardware.

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
`better-sqlite3` will fail to load with an ABI mismatch.

## Where your data lives

The database is kept in Electron's per-user data directory, never the install
directory, so updating the application cannot overwrite a shop's data.

| Platform | Path                                               |
| -------- | -------------------------------------------------- |
| Windows  | `%APPDATA%\pos-desktop\pos.db`                     |
| Linux    | `~/.config/pos-desktop/pos.db`                     |
| macOS    | `~/Library/Application Support/pos-desktop/pos.db` |

Uploaded logos sit alongside it under `assets/`.

SQLite runs in WAL mode, so `pos.db` is accompanied by `pos.db-wal` and
`pos.db-shm`. **Copying `pos.db` alone can miss recent writes.** Use the
application's backup feature rather than copying the file by hand.

## Money and quantities

Every amount is stored as an integer number of **paise**, and every quantity as
integer **thousandths**. No financial value is ever a JavaScript float, and
operator input is parsed from the string rather than multiplied, because
`1.005 * 100` is `100.49999999999999` and rounds the wrong way.

The rules for tax, discounts and rounding are documented in
[docs/calculations.md](docs/calculations.md) and are implemented in exactly one
place, which the screen, the stored sale and the printed receipt all call.

## Known limitations

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
