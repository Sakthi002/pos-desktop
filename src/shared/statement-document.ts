import { formatPaise } from './money';
import { stateByCode } from './states';
import { themeCss } from './invoice-theme';
import { qrSvg, upiLink } from './qr';
import type { AppSettings } from './settings';
import type { CustomerAccount, CustomerReceipt } from './trade';

/**
 * What a customer owes, as a sheet of A4.
 *
 * Not a bill and not a demand: a statement of the bills that are still open
 * and the money already received against them, so a customer can check it
 * against their own records before paying. Every figure on it is derived from
 * documents the shop has already issued — nothing here is typed by hand.
 */

const esc = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const day = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function buildStatementHtml(input: {
  account: CustomerAccount;
  receipts: CustomerReceipt[];
  settings: AppSettings;
  logoDataUrl?: string | null;
  /** Ends the statement at a date, which is the date it was drawn. */
  asOfIso?: string;
}): string {
  const { account, receipts, settings } = input;
  const shop = settings.shop;
  const stateName = stateByCode(shop.stateCode)?.name;
  const asOf = input.asOfIso ?? new Date().toISOString();

  const headerLines = [
    shop.address ?? '',
    [shop.city, shop.pincode].filter(Boolean).join(' - '),
    stateName ?? '',
    shop.phone ? `Ph: ${shop.phone}` : '',
    settings.tax.registered && shop.gstin ? `GSTIN: ${shop.gstin}` : '',
  ].filter((line) => line.trim() !== '');

  // Only what is still due: a bill that has been settled belongs in the
  // receipts below, not under a heading that says it is open.
  const openBills = account.bills.filter((bill) => bill.outstandingPaise > 0);

  const bills = openBills
    .map(
      (bill) => `<tr>
        <td>${day(bill.invoiceDate)}</td>
        <td><strong>${esc(bill.invoiceNumber)}</strong></td>
        <td class="num">${formatPaise(bill.totalPaise, false)}</td>
        <td class="num">${formatPaise(bill.creditPaise, false)}</td>
        <td class="num"><strong>${formatPaise(bill.outstandingPaise, false)}</strong></td>
      </tr>`,
    )
    .join('');

  const paid = receipts
    .slice(0, 12)
    .map(
      (receipt) => `<tr>
        <td>${day(receipt.receiptDate)}</td>
        <td>${esc(receipt.invoiceNumber ?? 'On account')}</td>
        <td>${esc(receipt.method.toUpperCase())}${receipt.reference ? ` · ${esc(receipt.reference)}` : ''}</td>
        <td class="num">${formatPaise(receipt.amountPaise, false)}</td>
      </tr>`,
    )
    .join('');

  // A statement a customer can pay from is worth more than one they must ring
  // about, so the code carries the outstanding amount.
  const upi = settings.template.upiId;
  const payCode =
    upi && account.outstandingPaise > 0
      ? `<div class="paycode">
          ${qrSvg(
            upiLink({
              vpa: upi,
              payee: shop.name,
              amountPaise: account.outstandingPaise,
              note: `${account.customerName} account`,
            }),
            26,
          )}
          <span class="label">Scan to pay</span>
          <span class="muted">${esc(upi)}</span>
        </div>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Statement · ${esc(account.customerName)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14mm; font-family: 'Segoe UI', Arial, sans-serif;
         font-size: 11px; color: #111; -webkit-print-color-adjust: exact; }
  @media print { body { padding: 0; } }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .logo { max-height: 22mm; max-width: 50mm; }
  .shop-name { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
  .muted { color: #555; }
  .title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.08em;
           text-transform: uppercase; margin: 14px 0 10px; padding: 5px;
           border-top: 1px solid #111; border-bottom: 1px solid #111; }
  .meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 12px; }
  .label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  .r { text-align: right; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.items th, table.items td { border: 1px solid #bbb; padding: 5px 6px; }
  table.items th { background: #f1f1f4; font-size: 9.5px; text-transform: uppercase;
                   letter-spacing: 0.04em; text-align: left; }
  .num { text-align: right; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #666;
       margin: 0 0 6px; }
  .summary { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  table.totals { min-width: 62mm; border-collapse: collapse; }
  table.totals td { padding: 3px 0; }
  table.totals tr.grand td { border-top: 1px solid #111; padding-top: 6px;
                             font-size: 14px; font-weight: 700; }
  .paycode { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
  .paycode svg { display: block; }
  .paycode .label { font-weight: 700; color: #111; text-transform: none; letter-spacing: 0; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd;
          font-size: 9.5px; color: #555; }
  ${themeCss(settings)}
</style></head>
<body>
  <div class="head">
    <div>
      <p class="shop-name">${esc(shop.name)}</p>
      <div class="muted">${headerLines.map(esc).join('<br>')}</div>
    </div>
    ${settings.template.showLogo && input.logoDataUrl ? `<img class="logo" src="${input.logoDataUrl}" alt="">` : ''}
  </div>

  <div class="title">Statement of account</div>

  <div class="meta">
    <div>
      <div class="label">For</div>
      <div><strong>${esc(account.customerName)}</strong></div>
    </div>
    <div class="r">
      <div class="label">As on</div>
      <div><strong>${day(asOf)}</strong></div>
    </div>
  </div>

  <h3>Bills still open</h3>
  ${
    openBills.length === 0
      ? '<p class="muted">Nothing is outstanding. Thank you.</p>'
      : `<table class="items">
    <thead><tr>
      <th>Date</th><th>Bill</th><th class="num">Bill total</th>
      <th class="num">On account</th><th class="num">Still due</th>
    </tr></thead>
    <tbody>${bills}</tbody>
  </table>`
  }

  ${
    paid === ''
      ? ''
      : `<h3>Received, most recent first</h3>
  <table class="items">
    <thead><tr><th>Date</th><th>Against</th><th>How</th><th class="num">Amount</th></tr></thead>
    <tbody>${paid}</tbody>
  </table>`
  }

  <div class="summary">
    <div>${payCode}</div>
    <table class="totals">
      <tr class="grand"><td>Outstanding</td><td class="num">${formatPaise(account.outstandingPaise)}</td></tr>
    </table>
  </div>

  <div class="foot">
    This is a statement of account, not a bill. Every figure on it comes from
    bills already issued and money already received. If anything here does not
    match your records, please tell us before paying.
  </div>
</body></html>`;
}
