# Showing it to a shop

A demo that sells this app is not a tour of its screens. It is twenty minutes
in which a shopkeeper sees their own day happen on a computer, and nothing
surprising happens to you while they watch.

---

## Before they arrive

**Install on the demo machine and set up a shop that looks like theirs.** A
grocery owner should see rice, oil, dal and tea at believable prices — not
"Test Product 1". Use their town in the address. If they are registered,
switch GST on and put a real-looking GSTIN in; if they are not, switch it off,
because then the whole app stops mentioning tax and that is a selling point
of its own.

**Put a week of history in it.** An empty dashboard sells nothing. Twenty or
thirty bills across the last few days, a couple of purchases, one customer who
owes money, one batch close to expiry. Then the dashboard, the reports and the
statements all have something to say the moment you open them.

**Check these five things**, each of which has embarrassed someone before:

1. The printer, if you are taking one. Print a test page from
   Settings → Receipt & payments **before** the client is in the room.
2. The shop's logo and bill template — pick a theme and a colour that suit
   their trade, so the first bill they see looks like theirs.
3. Sign-in **off** for the demo, unless they asked about staff control. It is
   one less thing to type.
4. A backup taken, so you can restore the demo shop to its starting state
   afterwards.
5. The laptop's clock. Every date on screen comes from it.

---

## The twenty minutes

### 1. Open on the dashboard — "this is your morning" (2 min)

Takings today and over the week, how each compares with the span before it,
the average bill, what is running low, what expires soon, the last ten bills.

> "This is what you'd look at with your first tea. Everything here is what
> actually happened at your counter — nothing is typed twice."

### 2. Sell something (5 min — the heart of the demo)

Hand them the scanner, or let them type the first letters of a product.

- Scan two or three items. Change a quantity. Give a 10 rupee discount.
- Take cash, hand back change — or split it: ₹500 cash, the rest UPI.
- The bill prints, or the preview opens on screen.

> "Four keys: F2 to find, F4 to pay, F8 to hold a bill when someone goes back
> for salt. A new boy learns this in ten minutes."

Then show the bill carrying their own identity: Settings → Bill template,
switch Classic to Modern, change the colour, watch the sample redraw. If they
have a UPI id, put it in and show the code appear on the bill.

> "Your customer scans that and pays the exact amount, with the bill number
> on it, so you know which payment is which."

### 3. Something went wrong (2 min)

Open the bill you just made from Sales, return one line, and show the stock
come back and the refund recorded.

> "Nothing is ever deleted here. The bill stays, the return is its own
> document, and the books show both. That is what your auditor wants to see."

### 4. The shelf is emptying (3 min)

Inventory → running low. Then Orders → New order to the supplier → print or
save the PDF → "Goods arrived" → the bill opens with the ordered lines already
in it → save.

> "The order you sent and the bill that came back are the same conversation.
> You never type those items twice, and the stock goes up the moment you
> record the bill."

### 5. A customer who buys on credit (3 min)

Sell to a named customer, leave part of it unpaid — the app refuses to leave a
bill short unless you say so and the customer is inside their limit. Then show
their account: what they owe, what they have paid.

> "The shop and the books can't disagree about what Ravi owes, because the
> amount is worked out from the bills themselves."

### 6. End of the day (2 min)

Drawer → close the shift → count the cash → the difference recorded.

> "It tells you what should be in the drawer and keeps what actually was.
> Twenty rupees short on a Tuesday is a question you can ask on Wednesday."

### 7. Reports and the books (2 min)

Tax summary, daily sales, stock on hand, product-wise sales — twenty in all.
Export one to CSV and open it in their accountant's spreadsheet.

> "Your accountant gets this file. The trial balance under Accounts is posted
> from these same bills — not typed again by anyone."

### 8. The part they worry about (1 min)

Pull the network cable out, or switch off the Wi-Fi, and keep selling.

> "It never needed the internet. Your data is on this computer, in one file,
> and Backup takes a copy to a pen drive. Keep one off the machine."

---

## Questions they ask, and the honest answers

**"What if the computer dies?"**
Restore the backup on another machine and carry on. That is why the backup
reminder nags, and why a backup on the same disk is not a backup.

**"Can I use it in two shops?"**
Not in this version. Each shop runs its own copy. Two shops that share stock
need the two computers to agree about what happened, and that is a bigger
problem than it sounds — it is not pretended to be solved.

**"What does it cost every month?"**
Nothing. One installation, one payment.

**"Will it work on my old computer?"**
It is one Windows program and one file. No server, no browser, no internet.

**"Can I change what the bill looks like?"**
Four designs, your colour, your logo, your terms, your signature line, and the
columns you want. The arrangement of a GST invoice itself is fixed, because it
has to be.

**"Who can do what?"**
Turn sign-in on and a cashier bills and nothing else; a manager runs the shop;
you see everything. Each bill then records who rang it up.

**"My items have batches and expiry."**
Per product — only the ones that need it ask. The till sells the earliest
expiry first and refuses an expired batch outright.

---

## What not to promise

Two things in this version have never been proved on real hardware, and saying
so costs nothing while being caught out costs a client:

- **Printing on a thermal printer** has been built and tested on screen and
  to PDF, but no receipt has yet come out of a real 58 mm or 80 mm roll
  printer, and silent printing is not guaranteed by every driver.
- **The Windows installer** has never been built or run on a clean machine.

If the client is on Windows and wants paper receipts, make that the first
thing you prove on their own machine before taking money.

---

## After the demo

Restore the backup you took, so the demo shop is ready for the next client —
or, if they are buying, do the setup wizard with their real shop, their real
GSTIN and their real opening stock, and leave the demo data behind entirely.
