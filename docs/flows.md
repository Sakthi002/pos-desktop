# What happens, step by step

The app is a handful of documents and the paths between them. This is every
path a shop actually walks, from the first run to the end of the day.

---

## The documents, and what turns into what

```
                  QUOTATION ──────bill it──────▶ SALE ──────▶ CREDIT NOTE
                  (no stock,                   (stock out,     (stock back,
                   no money)                    money in)       money back)
                                                  │
                                                  └─ part-paid ─▶ CUSTOMER OWES
                                                                   │
                                                                   └─ RECEIPT

    PURCHASE ORDER ──goods arrived──▶ PURCHASE ──────▶ DEBIT NOTE
    (no stock,                       (stock in,       (stock back,
     nothing owed)                    money owed)      owed down)
                                         │
                                         └─────────▶ SUPPLIER PAYMENT

  Every one of these posts its own double-entry voucher, inside its own
  transaction. None of them is ever edited or deleted.
```

---

## 1. First run

```
app starts ─▶ no company row ─▶ Setup wizard
                                 │
     shop + GSTIN ─▶ invoice numbering ─▶ tax ─▶ receipt ─▶ review
                                                              │
                              one transaction: company, branch, operator,
                              walk-in customer, invoice sequences
                                                              │
                                                        the till opens
```

The database file is created in Electron's `userData` on first launch, and
every migration runs before the window appears.

---

## 2. A sale at the till

```
  scan / search          F2 search box, barcode, or the product wall
        │
  line added             price from the customer's price level
        │                batch chosen automatically: earliest expiry first
   quantity, discount    an expired batch is refused outright
        │
  calculateBill          ← the same engine quotes and previews with
        │                  CGST+SGST in-state, IGST across, rounding if set
      F4 pay
        │
  cash / UPI / card / bank, or several          change computed
        │
  ┌─────────────────── one transaction ───────────────────┐
  │ invoice number allocated   sale header + lines        │
  │ payments                   stock movements (out)      │
  │ loyalty points             ledger voucher             │
  │ quotation marked billed, if it came from one          │
  └───────────────────────────────────────────────────────┘
        │
   receipt preview ─▶ print · Save PDF · reprint later from Sales
```

If anything in that block fails, none of it happened — including the invoice
number, so no gap appears in a GST series.

**Part-paid:** only against a named customer, inside their credit limit, and
only when the shortfall is ticked. What they owe is derived from the documents
and appears on the receivables control in the books.

---

## 3. Putting it right

```
  the whole bill was wrong          part of it came back
        │                                   │
     VOID with a reason              CREDIT NOTE for the lines returned
        │                                   │
  stock back · reversing voucher     stock back into the batch it came from
  original sale kept, stamped        money refunded or credited
```

Both leave the original document untouched. If a manager's approval is
required above a value, the cashier is asked for it at this point.

---

## 4. A price given before a sale

```
  Quotations ─▶ New quotation ─▶ lines priced by calculateBill
                                     │
                            own series: SGS-QTN-0001
                            holds until a date, or until withdrawn
                                     │
         print / Save PDF ──────────┴────────── "Bill it"
                                                     │
                                     the till opens with the quoted lines,
                                     the customer and their price list
                                                     │
                                     the sale marks it billed inside the
                                     sale's own transaction — a second bill
                                     against the same price is refused
```

Cancelled with a reason, never edited. Expiry is read from the date, so a
quotation cannot be stale in the list and open on screen.

---

## 5. Buying, start to finish

```
  Orders ─▶ New order ─▶ supplier, goods, cost each, wanted-by date
                              │ own series: SGS-PO-0001, no tax
                              │
                 print / Save PDF ─▶ emailed or handed to the supplier
                              │
                      "Goods arrived"
                              │
  Purchases ◀───────── the bill opens prefilled with the ordered lines
        │
   check against what arrived: quantities, costs, tax mode, batches,
   expiry, MRP → selling price, bill discount
        │
  ┌─────────────────── one transaction ───────────────────┐
  │ purchase header + lines    stock movements (in)       │
  │ batches created            supplier owed              │
  │ ledger voucher             order marked received      │
  └───────────────────────────────────────────────────────┘
        │
   pay now at the counter, or later: Suppliers ─▶ Pay ─▶ payment voucher
```

A second bill against the same order is refused, and an order that was called
off cannot be received at all.

---

## 6. A day at the counter

```
  morning   Drawer ─▶ open shift with a float
     │
   selling  bills, returns, receipts against credit
     │
  evening   Drawer ─▶ close shift ─▶ count the cash
                           │
            expected = float + cash takings − change given
                       − refunds − anything paid out
                           │
            the difference is recorded, not corrected away
```

---

## 7. Sign-in, if the shop uses it

```
  Settings ─▶ Users ─▶ "Ask for a username and password"
        │
  the app asks for a sign-in immediately
        │
  each sale now records who rang it up
        │
  idle for N minutes ─▶ the till locks ─▶ sign in again
```

A cashier sees billing and customers; a manager sees the shop; the owner sees
everything including users, settings and backups.

---

## 8. Backup and restore

```
  Settings ─▶ Backup & restore
        │
   Back up now ──▶ SQLite backup API (never a file copy)
                   ├─ written to the chosen folder
                   ├─ verified by opening it and reading the schema
                   └─ stamped with the app and schema version
        │
   on a timer, if the shop sets one
        │
   Restore ──▶ refuses a file from a newer schema
               replaces the database, then the app restarts
```

The reminder to keep a copy off the machine is in the UI because a backup on
the same disk is not a backup.

---

## 9. Printing anything

```
  the renderer asks for a document by id
        │
  main builds the HTML from the stored record (never from the screen)
        │
  offscreen window loads it
        │
     ┌──────────────┬──────────────────┬───────────────────┐
  preview        Chromium print      printToPDF
  (iframe)       (A4 @page margins,  (save dialog, the
                  thermal in microns) same HTML)
```

Because all three come from one function, the preview cannot show a total the
printer disagrees with. A failed print says what a shopkeeper can act on —
"No printer is set up on this computer" rather than Chromium's wording.

---

## 10. What the books do while all this happens

```
  sale ───────────▶ Sales, Output CGST/SGST/IGST, Cash/Bank or Debtors
  credit note ────▶ Sales Returns, reversed tax, refund
  purchase ───────▶ Purchases, Input tax, Creditors
  debit note ─────▶ reverse of the purchase
  receipt ────────▶ Cash/Bank, Debtors down
  supplier payment ▶ Creditors down, Cash/Bank
  void ───────────▶ the exact reverse of the sale's own voucher
```

Every posting happens inside the document's transaction, is idempotent, and is
caught up by `postMissing()` at startup if a crash intervened. The books are
derived: they can be rebuilt from the documents, and a correction is always a
new voucher.
