# Report definitions

Every report in the app follows the rules below. They are written down because
two reports that count the same thing differently are worse than no report at
all — a shopkeeper reconciling the till against the tax summary has to be able
to trust that "sales" means the same thing on both.

The queries live in `src/main/db/repositories/reports.ts`; the columns, totals
and notes in `src/main/services/report-service.ts`.

## What counts as a sale

- Only invoices with status `completed`. A **voided** invoice is not a sale and
  never appears in any sales figure, count or tax total.
- Money is read from the stored invoice — the snapshot written at checkout —
  and never recalculated. Editing a product's price or tax rate today cannot
  move last week's numbers.
- Amounts are integer paise everywhere. Rupees appear only on screen and in the
  CSV, where money is written as a plain decimal so a spreadsheet can sum it.

## Dates

- A date range is a pair of instants. The screen turns the operator's local
  calendar day into UTC before asking, so "today" is the shop's today whatever
  the machine's timezone.
- Reports that group by day use the shop's **local** day, not the UTC day.
- A sale belongs to its `invoice_date`. A credit note belongs to its
  `return_date` — the day the money left the till, not the day of the original
  sale. A return raised in November against an October invoice therefore
  reduces November's net takings, and October's sales figure stays as it was
  reported.
- Stock on hand and low stock are snapshots of this moment, so they take no
  range.

## Returns

- Returns are never deleted from the sales figures. The sale stands as issued;
  the credit note is a separate document.
- **Daily sales** and the **sales summary** show sales and returns side by side,
  with `net = sales − returns`.
- The **tax summary** is net of credit notes raised in the same range, because
  that is the basis a GST return needs.
- **Product-wise** shows the quantity and value credited back as their own
  columns, and nets them out of estimated profit only.
- **Category-wise** does not deduct returns; the returns report lists them.

## Payments

- A payment's amount is what the operator entered, which for cash may exceed
  the bill. The surplus is recorded as change, so **collected** is
  `amount − change`: what actually stayed in the till.
- A refund is a payment with a negative amount against a credit note. It appears
  under the method it went out by, in the **refunded** column.

## Estimated gross profit

Labelled an estimate wherever it appears, because it is one.

- Revenue is the **taxable** value — ex-tax, net of discounts — not the invoice
  total. Tax collected is not income.
- Returns are deducted: both the credited value and the cost of the units that
  came back. The sales summary and the product report compute it from the same
  per-product basis, so the two always agree.
- Cost is the product's **current** cost price multiplied by the quantity sold.
  v1 has no purchase history, so an item sold before its cost was last edited is
  costed at today's figure.
- A product deleted from the catalogue has no cost, and contributes none.

Treat it as a trend, not a margin you could file.

## Stock

- A balance is always the sum of the movement ledger. No report reads a stored
  quantity, because none exists.
- **Stock on hand** covers active products with stock tracking on. It values
  stock at today's cost price and today's selling price.
- **Low stock** lists only products with a reorder level above zero that have
  reached it. A level of zero means the shop never set one, and would otherwise
  make every product at zero stock look like an alert.
- **Stock movement** lists every change in the range, newest first. Quantities
  are shown with their unit and are never summed across units.

## CSV export

Every report exports with the same columns the screen shows, from the same rows.
The file carries the report title, the range and any note, so a saved file still
explains itself months later.
