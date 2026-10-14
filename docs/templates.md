# Bill templates

A tax invoice has to show particular things: who sold, who bought, what was
sold, at what rate, how much tax, and the total. That is fixed. What differs
between shops is the dress, so the bill is one document with a stylesheet over
it rather than a layout each shop draws for itself.

Settings → **Bill template**, with a live preview of a sample bill that is
priced by the same engine as the till, so what is on screen is a document the
shop could really print.

## The designs

| Theme    | What it looks like                                                    |
| -------- | --------------------------------------------------------------------- |
| Classic  | Plain rules and a boxed table. What a shop expects a bill to look like |
| Modern   | A coloured band across the head, and lines instead of a grid           |
| Compact  | Smaller type and tighter rows, for bills that run long                 |
| Bordered | A frame around the sheet, with each part in its own box                |

All four print the same markup; a theme is a stylesheet appended after the
shared one. That is deliberate — a shop cannot pick a design that leaves out a
column the law requires, and a bug in one theme cannot change what another
theme's figures say.

The quotation sheet takes the same theme and colour, so a customer who gets a
quotation and then a bill sees the same shop twice rather than two different
ones.

## What a shop chooses

- **Colour.** Used for the rules that carry weight — the title, the head of the
  items table, the line above the total — and, in Modern, the header band. Any
  colour as `#RRGGBB`; tints of it are mixed with white where a theme needs a
  wash rather than a line.
- **Logo**, on or off, from the shop profile.
- **HSN column**, on or off. A shop that is not registered for GST never prints
  it in any case.
- **Discount column**, for shops whose bills never carry one.
- **Signature line**, with the shop's own wording when "For <shop name>" is not
  what it signs as.
- **Terms**, printed at the foot of an A4 bill.
- **Payment details** — a bank account, or anything else a customer paying
  later needs.
- **UPI id.** With one, the bill carries a code the customer scans to pay: the
  exact amount, with the invoice number as its reference, so the money arrives
  labelled. It asks for what is still owed on a credit sale and for the whole
  bill otherwise, and it is left off entirely when there is nothing to collect.
  The code is drawn by the app (`src/shared/qr.ts`): byte mode, correction
  level M, the smallest version that fits. It was checked module for module
  against an independent encoder and read back by a scanner from the rendered
  page, because a code that does not scan is worse than no code.

Everything typed by the shop is escaped before it reaches the document, so an
ampersand in a shop's name stays an ampersand and a stray `<` cannot break the
bill.

## What is not here

- No drag-and-drop designer. The body of a tax invoice is a legal document
  whose layout has been tested; a shop that needs a different one is asking for
  a change to the software, not a setting.
- No QR anywhere else. The encoder covers what a payment link needs — one
  mode, one correction level, versions 1 to 10 — and refuses anything longer
  rather than printing half a link.
- Thermal receipts are not themed. They are 58 or 80 mm of monochrome paper,
  where the only choices that mean anything — the footer line and the tax
  breakdown — are already in Settings → Receipt.
