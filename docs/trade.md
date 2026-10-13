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

A bill may be left part-paid only when three things are true: a named customer
is on it, they have a credit limit, and the shortfall keeps them inside it. The
shortfall has to be ticked at the payment screen — an underpaid bill with
nothing ticked is a mistake, and is refused as one.

What a customer owes is derived, never stored: bills taken on credit, less
credit notes against them, less what has been received. The unpaid part goes
to the customer's own line in **Customers owe us**, so their statement in the
books and their account at the counter are the same figure.

Money received against an account can sit on one bill or on the account.
Either way it posts a receipt voucher as it is written.

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
