import { formatPaise } from './money';
import { formatQuantity, precisionFor } from './quantity';
import { stateByCode } from './states';
import { themeCss } from './invoice-theme';
import type { AppSettings } from './settings';
import type { PurchaseOrder } from './purchase-orders';

/**
 * The order as a sheet of A4, for sending to a supplier.
 *
 * It states what is wanted, at what cost, and by when, and says in so many
 * words that it is not a bill: a supplier must never be able to read it as one
 * and a tax officer must never find it filed as one.
 *
 * It carries no tax. What tax is charged is settled by the supplier's own
 * bill, and an order that guessed at it would be contradicted on arrival.
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

export function buildPurchaseOrderHtml(input: {
  order: PurchaseOrder;
  settings: AppSettings;
  logoDataUrl?: string | null;
}): string {
  const { order, settings } = input;
  const shop = settings.shop;
  const stateName = stateByCode(shop.stateCode)?.name;

  const headerLines = [
    shop.address ?? '',
    [shop.city, shop.pincode].filter(Boolean).join(' - '),
    stateName ?? '',
    shop.phone ? `Ph: ${shop.phone}` : '',
    settings.tax.registered && shop.gstin ? `GSTIN: ${shop.gstin}` : '',
  ].filter((line) => line.trim() !== '');

  const rows = order.lines
    .map(
      (line) => `<tr>
        <td>${line.lineNo}</td>
        <td>${esc(line.name)}${line.sku ? `<br><span class="muted">${esc(line.sku)}</span>` : ''}</td>
        <td class="num">${formatQuantity(line.quantityMilli, precisionFor(line.unitCode))} ${esc(line.unitCode)}</td>
        <td class="num">${formatPaise(line.unitCostPaise, false)}</td>
        <td class="num">${formatPaise(line.totalPaise, false)}</td>
      </tr>`,
    )
    .join('');

  const dead = order.status === 'cancelled';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(order.orderNumber)}</title>
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
  .wanted { margin-top: 10px; padding: 7px 9px; border: 1px solid #d8b989;
            background: #fdf5e7; font-weight: 600; }
  .terms { margin-top: 12px; white-space: pre-wrap; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd;
          font-size: 9.5px; color: #555; }
  .stamp { display: inline-block; margin-bottom: 8px; padding: 4px 9px;
           border: 1px solid #b42318; color: #b42318; font-weight: 700;
           letter-spacing: 0.08em; text-transform: uppercase; }
  .sign { margin-top: 22mm; text-align: right; }
  .sign span { display: inline-block; padding-top: 6px; border-top: 1px solid #999; min-width: 55mm; }
  ${themeCss(settings)}
</style></head>
<body>
  ${dead ? `<div class="stamp">Cancelled</div>` : ''}
  ${
    order.status === 'received'
      ? `<div class="stamp" style="border-color:#0a7c55;color:#0a7c55">Received · ${esc(order.receivedPurchaseNumber)}</div>`
      : ''
  }

  ${
    settings.template.showLogo || !input.logoDataUrl
      ? `<div class="head">
    <div>
      <p class="shop-name">${esc(shop.name)}</p>
      <div class="muted">${headerLines.map(esc).join('<br>')}</div>
    </div>
    ${settings.template.showLogo && input.logoDataUrl ? `<img class="logo" src="${input.logoDataUrl}" alt="">` : ''}
  </div>`
      : ''
  }

  <div class="title">Purchase Order</div>

  <div class="meta">
    <div>
      <div class="label">To</div>
      <div><strong>${esc(order.supplierName)}</strong></div>
      ${order.supplierPhone ? `<div class="muted">Ph: ${esc(order.supplierPhone)}</div>` : ''}
      ${order.supplierGstin ? `<div class="muted">GSTIN: ${esc(order.supplierGstin)}</div>` : ''}
    </div>
    <div class="r">
      <div class="label">Order</div>
      <div><strong>${esc(order.orderNumber)}</strong></div>
      <div class="muted">${day(order.orderDate)}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th>#</th><th>Description</th><th class="num">Quantity</th>
      <th class="num">Cost</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div style="flex:1">
      ${
        order.expectedOn
          ? `<div class="wanted">Wanted by ${day(order.expectedOn)}.</div>`
          : '<div class="wanted">No date given; send when you can.</div>'
      }
      ${order.notes ? `<div class="terms">${esc(order.notes)}</div>` : ''}
    </div>

    <table class="totals">
      <tr class="grand"><td>Order value</td><td class="num">${formatPaise(order.totalPaise)}</td></tr>
    </table>
  </div>

  ${
    settings.template.showSignature
      ? `<div class="sign"><span>For ${esc(settings.template.signatureLabel || shop.name)}</span></div>`
      : ''
  }

  <div class="foot">
    This is an order, not a bill. Nothing has been bought and nothing is owed
    on it. Costs are what we expect to be charged; tax is as your bill states.
  </div>
</body></html>`;
}
