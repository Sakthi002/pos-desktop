# Sending a document on WhatsApp

A shop that can hand a customer their bill on paper can also send it to their
phone. This is how, and — just as important — what the app cannot do, so
nobody promises a client something WhatsApp does not allow.

## What the shop does

1. Open the bill, quotation or order, or a customer's account.
2. Press **WhatsApp** (the green button beside Save PDF and Print).
3. Check the number and edit the message if they want to.
4. Press **Open WhatsApp**.

The app then:

- renders the A4 sheet twice — once as a picture, once as a PDF — and saves
  both in **Documents → POS Outbox**, named after the document (`SGS-1023.pdf`);
- puts the picture on the clipboard;
- opens a window on the PDF, with the file selected;
- opens WhatsApp on that number with the message already typed.

The shopkeeper drags the PDF into the chat and presses Enter. If a picture
will do instead of a file, Ctrl+V pastes it without going near the folder.

## Why it works this way

**A `wa.me` link carries text and nothing else.** No desktop application can
attach a file to a WhatsApp chat from outside WhatsApp — not this app, not any
other. There are exactly three ways a file reaches a chat: the person attaches
it, the person drags it in, or the **WhatsApp Business Cloud API** sends it.

That API was considered and rejected:

- it needs a Meta Business account, a verified number and a payment method;
- every message template has to be approved by Meta before it may be sent;
- conversations are charged per twenty-four hours, which is a subscription —
  and this product is sold for one payment, with nothing owed afterwards;
- it needs the internet, in a shop that is sold on working without it.

Libraries that drive WhatsApp Web unattended (`whatsapp-web.js`, Baileys and
their kin) were rejected too: they break the terms the shop agreed to when it
signed up, and a shop that loses its WhatsApp number loses its customers.

So the app does everything up to the last keystroke, and leaves that keystroke
to the shop. The conversation then sits in the shop's own WhatsApp, where the
customer can reply to it, which is where it belongs.

## The four documents

| From | What is sent | Permission |
| --- | --- | --- |
| Invoice preview | The bill, as A4 | `sale.view` |
| Quotation preview | The quotation sheet | `sale.view` |
| Order preview | The purchase order | `purchase.manage` |
| Customer → account | A statement of account | `sale.view` |

The permission follows the document, not the channel: a cashier may send a
customer their bill, and only somebody who buys for the shop may send an order
to a supplier. The check is in the handler, because the channel gate never
sees which document was asked for.

## The statement of account

The only one of the four that is not an existing document. It is drawn fresh
each time from bills already issued and money already received:

- the bills still open, with what is left due on each;
- the last twelve receipts, with how they were paid;
- the outstanding total;
- a UPI code to pay it, when the shop has set a UPI id and something is owed.

It says on its face that it is a statement and not a bill. Nothing on it is
typed by hand, and drawing one changes nothing — no row is written.

## The number

A shop types a number the way it is written down: `98765 43210`,
`+91 98765-43210`, `098765 43210`. All three become `919876543210`. A leading
zero is for dialling inside the country and is dropped. Ten digits are taken
as Indian; eleven to fifteen are taken as already carrying a country code.
Anything else is refused with the number shown back, rather than guessed at —
a bill sent to the wrong person cannot be recalled.

The number comes from the customer or supplier record, and may be corrected in
the dialog before sending. Correcting it there does not change the record;
correct it on the customer if it is wrong for good.

## The message

Each kind has its own opening, and all four say who it is from, which document
it is and how much. The shop can edit every word before it goes.

- **Bill** — "Here is your bill SGS-1023 from …", with the total, and a UPI
  line only when something is still owed on it.
- **Quotation** — the total and how long the price holds.
- **Order** — the order value and the date the goods are wanted by.
- **Statement** — what is outstanding and across how many bills, and a line
  asking them to ignore it if they have already paid.

## Where it lives

| Piece | File |
| --- | --- |
| Numbers, links and the four messages | `src/shared/whatsapp.ts` |
| The statement sheet | `src/shared/statement-document.ts` |
| Rendering, saving, clipboard, opening | `src/main/services/whatsapp-service.ts` |
| Channels `whatsapp:draft`, `whatsapp:send`, `whatsapp:reveal` | `src/main/ipc/index.ts` |
| The dialog | `src/renderer/src/components/WhatsAppDialog.tsx` |

The picture is captured from an offscreen window measured after it loads, so a
long bill is sent whole rather than cropped to a page. The PDF comes from the
same renderer that prints and exports, so what is sent, what is printed and
what is saved cannot differ.

## Not verified yet

Everything above has been exercised on Linux: the sheets render, both files
are written, the picture reaches the clipboard, the file manager opens on the
PDF and the link is handed to the desktop. **Dragging the PDF into WhatsApp
Desktop on Windows has not been tried**, because this machine is not the
machine a shop runs. Try it once on the first Windows install, with the
installer and the thermal printer. See `PLAN.md`.
