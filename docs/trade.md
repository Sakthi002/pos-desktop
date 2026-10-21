# Trade terms and the counter

## Price levels

Three lists: retail, wholesale and special. A product may carry a wholesale and
a special price beside its retail one; a level with no price set falls back to
retail, because a shop that has not set a wholesale price has not promised one.

A customer is set to a level and brings it to the till. A bill can be moved to
another level, which re-prices every line — except a line whose price the
operator has already typed over, because that was deliberate.

The level a bill was charged at is stored on the bill.

## Credit

A bill may be left part-paid when a named customer is on it. That is the whole
of the rule: a walk-in cannot owe, because there is nobody to ask. Nothing caps
a customer — a shop lends what it is willing to lend, and what it goes by is
what they already owe, which the till shows in red beside the price list and
the payment screen repeats under the tick. The shortfall has to be ticked —
it is ticked for you when the figures say so, and the button reads "On account"
before it is pressed, so an underpaid bill is never committed as a mistake.

Credit limits were taken out: they stopped sales a shop meant to make, and a
figure for what is owed does the same work without a form to fill. The column
remains on the record for what is already stored; nothing reads it.

A walk-in has no account, which used to end the sale there. The payment screen
now offers to open one: a name and a phone number, written as a customer, put
on the bill, and the shortfall ticked — without losing the bill. Opening an
account from the till needs the same permission as managing customers anywhere
else.

What a customer owes is derived, never stored: bills taken on credit, less
credit notes against them, less what has been received. The unpaid part goes
to the customer's own line in **Customers owe us**, so their statement in the
books and their account at the counter are the same figure.

Money received against an account can sit on one bill or on the account.
Either way it posts a receipt voucher as it is written. One payment may come
over the counter in more than one form — half cash, half UPI — and is entered
as one: each part is written as its own receipt, so the drawer still counts
only the cash, but the parts go in together or not at all.

## Shifts and the drawer

A shift is opened with the float put in and closed with what was counted out.
Every sale in between is stamped with it.

What the drawer should hold is computed, not stored:

> float + cash taken (net of change given) + cash received against accounts
> − cash refunded − cash paid out of the drawer

Card, UPI and bank takings are shown separately because they never touched the
drawer, and so is what went on account.

The difference between counted and expected is recorded and never corrected
away — noticing it is the point of counting. A shop that does not count its
drawer can ignore all of this and sell as usual: a sale with no shift open is
stamped with none.

Only one shift can be open at a counter at a time. Two would each be counting
the other's takings.

## Labels

Shelf labels print from the Products screen, on three sheet sizes, with the
price from whichever list is chosen. The barcode is Code 128, encoded in this
app rather than by a dependency: a label that prints and does not scan is worse
than no label, and the encoder is checked against hand-computed symbols.

A product with no barcode uses its SKU; one with neither still gets a label
with its name and price, which is what a shelf edge needs.

Labels can be skipped at the start of a sheet, so a part-used sheet is not
wasted.

## Multi-branch

Not built. The schema has carried `branch_id` on every document since the first
migration, and stock, sequences and shifts are already per branch — but a
second branch is only useful with a way to move stock between branches and a
way for two computers to agree on what happened, which is the sync problem this
version deliberately does not solve. Building the screens without that would
produce a second branch nobody could use.
