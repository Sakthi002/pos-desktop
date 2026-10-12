# Bill calculation

All of this is implemented in `src/shared/billing.ts`. It is the single place
tax, discount and rounding are computed — the POS screen, the stored sale and
any receipt or PDF call the same function, so a total cannot differ between
what the customer was shown, what was saved, and what was printed.

## Units

| Suffix   | Meaning                       | Example           |
| -------- | ----------------------------- | ----------------- |
| `_paise` | Money, integer minor units    | `49900` = ₹499.00 |
| `_milli` | Quantity, integer thousandths | `1500` = 1.5 kg   |
| `_bp`    | Rate in basis points          | `1800` = 18.00%   |

No financial value is ever a JavaScript float. Operator input is parsed from
the **string**, not via `Number(x) * 100`, because that multiplication is
wrong at the paisa: `1.005 * 100` is `100.49999999999999`, which rounds to 100
rather than 101.

## Order of operations

1. **Line gross** = quantity × unit price, rounded to the paisa, half away
   from zero.
2. **Item discount** subtracted from the line, capped at the line value.
3. **Cart discount** apportioned across lines in proportion to their value
   after step 2. Apportioning uses largest-remainder, so the shares sum to
   exactly the discount and the leftover paise land on the lines with the
   biggest fractional claim.
4. **Tax** computed per line on the discounted amount:
   - inclusive: `taxable = net × 10000 / (10000 + rate)`, `tax = net − taxable`
   - exclusive: `taxable = net`, `tax = net × rate / 10000`
   - a rate of 0 is exempt: taxable is the net, tax is zero, and the inclusive
     and exclusive paths agree
5. **CGST/SGST** half each within the state, split so the halves sum exactly to
   the tax. **IGST** carries the whole amount across state lines.
6. **Round-off** of the invoice total to the nearest rupee when enabled,
   recorded as its own figure.

Discounts are applied **before** tax, which is why a line's tax reflects what
was actually charged for it rather than its list price.

## Rounding

Half away from zero, at every step. `roundToRupee` returns both the rounded
figure and the adjustment, and the adjustment appears as its own line on the
invoice so the bill reconciles:

```
taxable + tax + roundOff === total
```

This is asserted by test across every combination of five prices and five GST
slabs.

## Inter-state determination

The customer's `state_code` is compared against the branch's. Different means
IGST; same, or unknown, means CGST + SGST. A walk-in customer has no state, so
sales default to local — which is correct for a shop selling over the counter.

Getting this wrong puts the wrong tax breakdown on every invoice, which is why
the state is collected during setup and the wizard warns when a GSTIN's first
two digits disagree with the selected state.

## What the server does not trust

At checkout, line **tax rate, HSN, unit, name, SKU and barcode are read from
the product**, not taken from the renderer. Only quantity, unit price and
discount come from the till, because a price override is a legitimate thing
for a shopkeeper to do. A compromised or buggy renderer cannot alter the tax
charged.

## Compliance

This describes what the software computes. It is **not** a statement that the
output satisfies GST law. Production invoice formats, credit notes, rounding
rules and record retention must be verified against current rules before
release.
