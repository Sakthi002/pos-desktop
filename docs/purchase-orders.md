# Purchase orders

What a shop asks a supplier to send, before anything arrives. The mirror of a
quotation: there a shop puts a price in writing for a customer, here it puts an
order in writing for a supplier.

An order moves no stock, owes no money and posts nothing to the books. All
three happen when the goods arrive and the supplier's bill is entered, and
that bill is its own document which points back at the order.

## What it carries

A supplier, the goods and the cost each is expected at, a date the goods are
wanted by, and a note. Nothing else:

- **No tax.** What tax is charged is settled by the supplier's bill. An order
  that guessed at it would be contradicted on arrival, and two documents
  disagreeing about tax is worse than one staying silent.
- **No payment.** Nothing is owed until there is a bill to owe it against.
- **No batches or expiry.** Those describe the goods that actually turned up,
  which is the bill's business.

Its number comes from its own series — `SGS-PO-0001` — so it can never take a
number out of a series that has to run unbroken.

## What becomes of it

| Status    | What it means                                               |
| --------- | ----------------------------------------------------------- |
| Open      | Sent, nothing has arrived yet                               |
| Overdue   | Open, and past the date the goods were wanted by            |
| Received  | The goods came and their bill was entered against the order |
| Cancelled | Called off, with the reason kept beside it                  |

Overdue is read from the date rather than stored, so an order cannot be late
in the list and on time on the screen.

**Goods arrived** opens the purchase screen with the supplier and the ordered
lines already filled in, so the shop checks the bill against what it asked for
instead of typing it again. Everything the bill decides — tax, batches, what
was actually sent, what is paid now — is still entered there. Saving that bill
marks the order received *inside the bill's own transaction*, so one order can
never be received twice, and an order that was called off cannot be received
at all.

An order is never edited. One that was sent is a thing that happened: a wrong
one is called off with a reason and ordered again. A trigger refuses a delete.

## The sheet

A4, in whatever theme the shop picked for its bills, headed **Purchase Order**
with the supplier it is addressed to, the goods, the date wanted, the note, the
order value and a signature line. It stamps one that was cancelled or received,
and says at the foot that it is an order and not a bill — a supplier must never
be able to read it as one, and nor must a tax officer. It prints, or saves as a
PDF for emailing, which is how most orders reach a supplier.
