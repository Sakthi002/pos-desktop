# Batches and expiry

Off per product. A shop selling soap should never be asked for an expiry date,
so **keep batches** is a tick on the product, not a setting for the whole shop.

## What a batch is

A quantity of one product that arrived together and goes out of date together.
It carries a batch number, a manufacturing date and an expiry — and the cost it
actually arrived at, which the product's current cost price does not remember.

A date here is a **day**, not an instant: an expiry is printed on a packet as a
date and means the end of that day, wherever the shop is.

## Stock arriving

A supplier's bill asks for the batch number and expiry on any line whose
product keeps batches, and refuses the line without one. A batch that arrives
again under the same number keeps its identity and adds to its balance; what
the new bill says about its dates and cost wins, because that was read off the
carton today.

## Selling

The till takes the **earliest expiry first**. One sale line can therefore leave
several stock movements, one per batch, and they add up to the line.

An expired batch is never sold. Not a warning — a refusal, and the sale does
not get written. A shop with nothing but expired stock of an item is told so in
those words, because the fix is to remove it from the shelf rather than to try
again.

A batch with no expiry date goes last, after everything that will go out of
date.

## Goods coming back

A return goes back to the batch it came out of, never to a newer one: a packet
returned today still expires when its own batch does. A void does the same for
the whole sale.

If more comes back than the sale ever took from a batch — which should not
happen, but the arithmetic allows it — the remainder goes back without a batch
rather than inventing one. It stays visible, and the product balance still adds
up.

## Balances

The balance of a batch is the sum of the movements carrying it, exactly as the
balance of a product is the sum of all its movements. Nothing is stored twice,
so the two can never disagree.

## What is about to go out of date

- **Inventory → Batches** lists every batch holding stock, soonest first.
- **Reports → Expiring stock** lists what expires within 90 days, including
  anything already expired, with days shown as a negative number.
- The dashboard counts what expires **within a month**, which is the window a
  shop can still act in: return it, discount it, or move it to the front.

## Valuation

Chosen per product, and it decides what the stock reports say stock is worth.

- A product that **keeps batches** is valued at what its remaining batches
  actually cost. The shelf is known, so there is nothing to assume.
- A product that does not is valued by its chosen method over the arrivals that
  stated a cost: **FIFO** leaves the newest arrivals on the shelf, **LIFO** the
  oldest, **average** ignores the order altogether.
- A product that never arrived with a cost falls back to its cost price.
