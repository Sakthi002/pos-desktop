# Quotations

A quotation is a price put in writing before anything is sold. It moves no
stock, takes no money and posts nothing to the books — which is the whole
reason it is its own document rather than a draft sale.

## Where it comes from

**Quotations → New quotation.** The screen works like the till: find a product,
set a quantity, watch the total. What it will not do is take payment.

Prices come from the chosen price list, and a quotation given to a named
customer picks up their list automatically. Any line price can be typed over;
the price that was shown is the price that is stored.

The arithmetic is `calculateBill`, the same engine the till bills with, so a
quotation and the invoice that follows it cannot disagree. A test asserts it.

## Its number

Quotations have their own series — `INV-QTN-0001` upwards, where `INV` is the
shop's invoice prefix — and their own sequence table. A quotation never takes a
number out of the invoice series, which under GST has to run unbroken: a number
issued to a quotation and later not billed would be a gap no one can explain.

Like invoices, the series restarts each financial year.

## How long it holds

A quotation holds for a number of days, seven by default, and may be given with
no expiry at all. Nothing runs to make one stale: the status is read from the
date whenever it is looked at, so a quotation cannot be expired in the list and
open on the screen.

Status, then, is one of four:

| Status    | Means                                            |
| --------- | ------------------------------------------------ |
| Open      | Still good, still unbilled                       |
| Expired   | Open, but past the day the price was promised to |
| Billed    | Turned into an invoice, which it names           |
| Cancelled | Withdrawn, with the reason stored                |

## Billing one

**Bill it** opens the till with the quoted lines, the customer and their price
list, at the prices that were quoted rather than today's. The bill can still be
changed before payment — it is a new document, not a locked one.

When the sale is written, the quotation is marked billed inside the sale's own
transaction, so the two can never disagree. A second bill against the same
quotation is refused, and so is billing one that was cancelled.

A quotation that was never billed leaves no trace in stock or in the books.

## Correcting one

A quotation is never edited. A price a customer has seen is a thing that
happened; if it was wrong, cancel it with a reason and quote again. A trigger
refuses a delete, as it does for sales.

## What it prints

An A4 sheet headed **Quotation**, carrying the validity line, the shop's
signature block and, at the foot, the sentence that keeps it out of trouble:

> This is a quotation, not an invoice. Nothing has been sold and no tax is
> payable on it.

A cancelled, expired or billed quotation is stamped as such, and a billed one
names the invoice it became. A shop that is not GST-registered prints no tax
columns and no registration number, exactly as its invoices do.

## What it is not

- Not a sale: no stock movement, no payment, no voucher, no invoice number.
- Not an order: nothing is reserved, and stock quoted may be sold meanwhile.
- Not editable, and not deletable.
