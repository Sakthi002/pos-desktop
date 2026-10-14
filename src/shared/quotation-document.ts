import { formatPaise } from './money';
import { formatQuantity, precisionFor } from './quantity';
import { stateByCode } from './states';
import { themeCss } from './invoice-theme';
import type { AppSettings } from './settings';
import type { Quotation } from './quotations';

/**
 * The quotation as a sheet of A4.
 *
 * Deliberately not a receipt template with a different heading: a quotation
 * states what it is at the top, says how long the price holds, and says in so
 * many words that it is not an invoice. A customer should never be able to
 * mistake one for the other, and neither should a tax officer.
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

export function buildQuotationHtml(input: {
  quotation: Quotation;
  settings: AppSettings;
  logoDataUrl?: string | null;
}): string {
  const { quotation, settings } = input;
  const bill = quotation.bill;
  const taxed = settings.tax.registered;
  const interstate = bill.isInterstate;
  const shop = settings.shop;
  const stateName = stateByCode(shop.stateCode)?.name;

  const headerLines = [
    shop.address ?? '',
    [shop.city, shop.pincode].filter(Boolean).join(' - '),
    stateName ?? '',
    shop.phone ? `Ph: ${shop.phone}` : '',
    taxed && shop.gstin ? `GSTIN: ${shop.gstin}` : '',
  ].filter((line) => line.trim() !== '');

  const rows = bill.lines
    .map((line) => {
      const precision = precisionFor(line.unitCode);
      return `<tr>
        <td>${line.lineNo}</td>
        <td>${esc(line.name)}${line.sku ? `<br><span class="muted">${esc(line.sku)}</span>` : ''}</td>
        <td class="num">${formatQuantity(line.quantityMilli, precision)} ${esc(line.unitCode)}</td>
        <td class="num">${formatPaise(line.unitPricePaise, false)}</td>
        <td class="num">${line.totalDiscountPaise > 0 ? formatPaise(line.totalDiscountPaise, false) : '—'}</td>
        <td class="num">${formatPaise(line.taxablePaise, false)}</td>
        ${
          taxed
            ? `<td class="num">${(line.taxRateBp / 100).toFixed(0)}%</td>
               <td class="num">${formatPaise(line.taxPaise, false)}</td>`
            : ''
        }
        <td class="num">${formatPaise(line.totalPaise, false)}</td>
      </tr>`;
    })
    .join('');

  const dead = quotation.status === 'cancelled' || quotation.status === 'expired';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(quotation.quotationNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14mm;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11px;
    color: #111;
    -webkit-print-color-adjust: exact;
  }
  @media print { body { padding: 0; } }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .logo { max-height: 22mm; max-width: 50mm; }
  .shop-name { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
  .muted { color: #555; }
  .title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.08em;
           text-transform: uppercase; margin: 14px 0 10px; padding: 5px;
           border-top: 1px solid #111; border-bottom: 1px solid #111; }
  .meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 12px; }
  .meta div { flex: 1; }
  .label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  .r { text-align: right; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.items th, table.items td { border: 1px solid #bbb; padding: 5px 6px; }
  table.items th { background: #f1f1f4; font-size: 9.5px; text-transform: uppercase;
                   letter-spacing: 0.04em; text-align: left; }
  .num { text-align: right; }
  .summary { display: flex; justify-content: space-between; gap: 24px; }
  table.totals { min-width: 62mm; border-collapse: collapse; }
  table.totals td { padding: 3px 0; }
  table.totals tr.grand td { border-top: 1px solid #111; padding-top: 6px;
                             font-size: 14px; font-weight: 700; }
  .validity { margin-top: 10px; padding: 7px 9px; border: 1px solid #d8b989;
              background: #fdf5e7; font-weight: 600; }
  .terms { margin-top: 12px; white-space: pre-wrap; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd;
          font-size: 9.5px; color: #555; }
  .stamp { display: inline-block; margin-bottom: 8px; padding: 4px 9px;
           border: 1px solid #b42318; color: #b42318; font-weight: 700;
           letter-spacing: 0.08em; text-transform: uppercase; }
  .sign { margin-top: 22mm; text-align: right; }
  .sign span { display: inline-block; padding-top: 6px; border-top: 1px solid #999; min-width: 55mm; }
  /* A quotation is dressed like the invoice it may become, so a customer sees
     the same shop twice rather than two different ones. */
  ${themeCss(settings)}
</style></head>
<body>
  ${dead ? `<div class="stamp">${quotation.status === 'cancelled' ? 'Cancelled' : 'Expired'}</div>` : ''}
  ${quotation.status === 'converted' ? `<div class="stamp" style="border-color:#0a7c55;color:#0a7c55">Billed · ${esc(quotation.convertedInvoiceNumber)}</div>` : ''}

  <div class="head">
    <div>
      <p class="shop-name">${esc(shop.name)}</p>
      <div class="muted">${headerLines.map(esc).join('<br>')}</div>
    </div>
    ${settings.template.showLogo && input.logoDataUrl ? `<img class="logo" src="${input.logoDataUrl}" alt="">` : ''}
  </div>

  <div class="title">Quotation</div>

  <div class="meta">
    <div>
      <div class="label">For</div>
      <div>${esc(quotation.customerName ?? 'Walk-in customer')}</div>
      ${quotation.customerGstin ? `<div class="muted">GSTIN: ${esc(quotation.customerGstin)}</div>` : ''}
    </div>
    <div class="r">
      <div class="label">Quotation</div>
      <div><strong>${esc(quotation.quotationNumber)}</strong></div>
      <div class="muted">${day(quotation.quotationDate)}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th>
      <th class="num">Disc</th><th class="num">${taxed ? 'Taxable' : 'Value'}</th>
      ${taxed ? '<th class="num">GST</th><th class="num">Tax</th>' : ''}
      <th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div style="flex:1">
      ${
        quotation.validUntil
          ? `<div class="validity">This price holds until ${day(quotation.validUntil)}.</div>`
          : '<div class="validity">This price holds until withdrawn.</div>'
      }
      ${quotation.notes ? `<div class="terms">${esc(quotation.notes)}</div>` : ''}
      ${quotation.terms ? `<div class="terms muted">${esc(quotation.terms)}</div>` : ''}
    </div>

    <table class="totals">
      ${
        bill.itemDiscountPaise + bill.cartDiscountPaise > 0
          ? `<tr><td>Gross value</td><td class="num">${formatPaise(bill.grossPaise, false)}</td></tr>
             <tr><td>Less discount</td><td class="num">-${formatPaise(bill.itemDiscountPaise + bill.cartDiscountPaise, false)}</td></tr>`
          : ''
      }
      <tr><td>${taxed ? 'Taxable value' : 'Value'}</td><td class="num">${formatPaise(bill.taxablePaise, false)}</td></tr>
      ${
        !taxed
          ? ''
          : interstate
            ? `<tr><td>IGST</td><td class="num">${formatPaise(bill.igstPaise, false)}</td></tr>`
            : `<tr><td>CGST</td><td class="num">${formatPaise(bill.cgstPaise, false)}</td></tr>
               <tr><td>SGST</td><td class="num">${formatPaise(bill.sgstPaise, false)}</td></tr>`
      }
      ${bill.roundOffPaise !== 0 ? `<tr><td>Round off</td><td class="num">${bill.roundOffPaise > 0 ? '+' : '-'}${formatPaise(Math.abs(bill.roundOffPaise), false)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="num">${formatPaise(bill.totalPaise, false)}</td></tr>
    </table>
  </div>

  ${
    settings.template.showSignature
      ? `<div class="sign"><span>For ${esc(settings.template.signatureLabel || shop.name)}</span></div>`
      : ''
  }

  <div class="foot">
    This is a quotation, not an invoice. Nothing has been sold and no tax is
    payable on it. Prices and availability are subject to change after the date
    above.
  </div>
</body></html>`;
}
