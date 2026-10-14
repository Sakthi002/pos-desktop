# Universal POS — the documentation

An offline-first point of sale for one shop on one Windows computer. No
server, no subscription, no internet. Everything the shop knows lives in one
SQLite file on that machine.

## Start here

| If you want to… | Read |
| --- | --- |
| Show the app to a client | **[demo.md](demo.md)** — the twenty-minute demo, with what to say and what not to promise |
| Understand the whole app | **[architecture.md](architecture.md)** — processes, the IPC contract, the database, the rules the code keeps |
| Follow what happens, step by step | **[flows.md](flows.md)** — every path from first run to end of day, with diagrams |
| Find where a feature lives | **[modules.md](modules.md)** — screen, service, repository and tables, module by module |
| Fix a shop that is in trouble | **[operations.md](operations.md)** — backups, restores, and what to do when something goes wrong |

## The features in detail

| Document | What it covers |
| --- | --- |
| [calculations.md](calculations.md) | How a bill is worked out: tax, discounts, rounding — the arithmetic the till, quotations and previews all share |
| [reports.md](reports.md) | Every report, what it counts and what it leaves out |
| [templates.md](templates.md) | How a bill is dressed: four themes, the shop's colour, the UPI pay code |
| [trade.md](trade.md) | Price levels, credit limits, the cash drawer — and why multi-branch is not built |
| [batches.md](batches.md) | Batches, expiry, which stock the till sells first, valuation |
| [loyalty.md](loyalty.md) | Points: earning, redeeming, tiers, expiry |
| [quotations.md](quotations.md) | A price put in writing before anything is sold |
| [purchase-orders.md](purchase-orders.md) | What a shop asks a supplier to send, and how it becomes a bill |
| [whatsapp.md](whatsapp.md) | Sending a bill, quotation, order or statement to a phone — and what WhatsApp will not let any app do |
| [users.md](users.md) | Sign-in, the three roles, who may do what |

## The shape of it, in one picture

```
   ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌─────────┐
   │  TILL   │   │ QUOTATION │   │  ORDERS  │   │ PRODUCTS│
   │  sell   │◀──│  promise  │   │   ask    │   │ catalogue│
   └────┬────┘   └───────────┘   └────┬─────┘   └────┬────┘
        │                             │              │
        │ stock out                   │ goods in     │ what exists
        ▼                             ▼              ▼
   ┌──────────────────────────────────────────────────────┐
   │              STOCK  —  a sum of movements            │
   └──────────────────────────────────────────────────────┘
        │                             │
        ▼                             ▼
   ┌──────────┐                 ┌───────────┐
   │ CUSTOMERS│                 │ SUPPLIERS │
   │ owe, earn│                 │ are owed  │
   └────┬─────┘                 └─────┬─────┘
        │                             │
        └──────────────┬──────────────┘
                       ▼
            ┌─────────────────────┐      ┌──────────────┐
            │  BOOKS  double entry│─────▶│   REPORTS    │
            │  posted by documents│      │  GST, sales, │
            └─────────────────────┘      │  stock, P&L  │
                       │                 └──────────────┘
                       ▼
            ┌─────────────────────┐
            │ BACKUP · AUDIT TRAIL│
            └─────────────────────┘
```

## Where the code is

```
src/renderer   React screens. Calls window.api only.
src/preload    The bridge: one function, invoke().
src/main       Window, IPC handlers, services, repositories, SQLite.
src/shared     Types, the IPC contract, and the arithmetic both sides use.
docs           This directory.
PLAN.md        The build plan, the progress log, and what is still open.
CLAUDE.md      The house rules for anyone — or anything — writing code here.
```

## The state of it

Phases 0 to 17 are complete: foundation, database, setup, catalogue, billing,
receipts, sales history, inventory and returns, customers and reports, backup
and audit, Ubuntu packaging, dashboard, suppliers and purchases, the ledger,
users and roles, loyalty, batches, trade terms, quotations, bill templates,
the UPI pay code and purchase orders. **577 tests** pass.

Two things are unproven, both needing hardware this machine does not have: no
receipt has come out of a **real thermal printer**, and the **Windows
installer** has never been built or run on a clean machine. `PLAN.md` keeps
the list.
