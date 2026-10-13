/**
 * Receipt and invoice rendering.
 *
 * One function produces the HTML for the on-screen preview, the PDF export and
 * the physical print. They cannot disagree about a total because they are the
 * same document — the spec's requirement that preview, PDF and print share one
 * invoice model.
 *
 * Paper sizes:
 *   58mm / 80mm  thermal rolls: single column, no table borders, narrow type
 *   a4           a full tax invoice with a bordered table and a GST summary
 */
import type { SaleReceipt } from './sale';
import type { AppSettings } from './settings';
import { formatPaise } from './money';
import { formatQuantity, precisionFor } from './quantity';
import { stateByCode } from './states';

export type PaperSize = AppSettings['receipt']['paperSize'];

export interface ReceiptRenderInput {
  receipt: SaleReceipt;
  settings: AppSettings;
  paperSize: PaperSize;
  /** Inlined by the main process; the renderer never reads from disk. */
  logoDataUrl?: string | null;
  /** Marks a second or later printing of the same invoice. */
  isReprint?: boolean;
}

/** Escapes text for HTML. Shop and product names routinely contain & and quotes. */
function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PAPER_WIDTH: Record<PaperSize, string> = {
  '58mm': '58mm',
  '80mm': '80mm',
  a4: '210mm',
};

function thermalStyles(width: string): string {
  return `
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      width: ${width};
      margin: 0;
      padding: 4mm 3mm;
      font-family: 'Courier New', monospace;
      font-size: 10.5px;
      line-height: 1.38;
      color: #000;
      -webkit-print-color-adjust: exact;
    }
    .c { text-align: center; }
    .r { text-align: right; }
    .b { font-weight: bold; }
    .logo { display: block; max-width: 70%; max-height: 16mm; margin: 0 auto 2mm; }
    .shop { font-size: 13px; font-weight: bold; }
    .rule { border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 0.4mm 0; vertical-align: top; }
    .item-name { word-break: break-word; }
    .totals td { padding: 0.5mm 0; }
    .grand td { font-size: 12.5px; font-weight: bold; padding-top: 1mm; }
    .foot { margin-top: 2mm; font-size: 9.5px; }
    .reprint { border: 1px solid #000; padding: 1mm; margin-bottom: 2mm; font-weight: bold; }
    .voided { border: 2px solid #000; padding: 1.5mm; margin-bottom: 2mm;
              font-weight: bold; letter-spacing: 0.12em; }
  `;
}

function a4Styles(): string {
  return `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      color: #111;
      -webkit-print-color-adjust: exact;
    }
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
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    table.items th, table.items td { border: 1px solid #bbb; padding: 5px 6px; }
    table.items th { background: #f3f4f6; font-size: 9.5px; text-transform: uppercase;
                     letter-spacing: 0.03em; text-align: left; }
    .num { text-align: right; }
    .summary { display: flex; justify-content: space-between; gap: 24px; }
    table.gst { border-collapse: collapse; font-size: 10px; }
    table.gst th, table.gst td { border: 1px solid #bbb; padding: 4px 7px; }
    table.gst th { background: #f3f4f6; }
    table.totals { margin-left: auto; min-width: 70mm; border-collapse: collapse; }
    table.totals td { padding: 4px 8px; }
    table.totals tr.grand td { border-top: 1.5px solid #111; font-size: 14px; font-weight: 700; }
    .foot { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd;
            font-size: 10px; color: #555; }
    .reprint { display: inline-block; border: 1px solid #111; padding: 2px 8px;
               font-size: 10px; font-weight: 700; margin-bottom: 8px; }
    .voided { display: block; border: 2px solid #111; padding: 5px 8px; text-align: center;
              font-size: 13px; font-weight: 700; letter-spacing: 0.14em; margin-bottom: 10px; }
  `;
}

function shopHeaderLines(settings: AppSettings): string[] {
  const shop = settings.shop;
  const stateName = stateByCode(shop.stateCode)?.name;
  return [
    shop.address ?? '',
    [shop.city, shop.pincode].filter(Boolean).join(' - '),
    stateName ?? '',
    shop.phone ? `Ph: ${shop.phone}` : '',
    shop.gstin ? `GSTIN: ${shop.gstin}` : '',
  ].filter((line) => line.trim() !== '');
}

function renderThermal(input: ReceiptRenderInput): string {
  const { receipt, settings, paperSize } = input;
  const bill = receipt.bill;
  const isTaxInvoice = Boolean(settings.shop.gstin);
  // A voided invoice can still be printed — for the customer, for the file —
  // but it must never read as a document anyone can claim against.
  const isVoided = receipt.status === 'voided';

  const items = bill.lines
    .map((line) => {
      const precision = precisionFor(line.unitCode);
      const qty = formatQuantity(line.quantityMilli, precision);
      return `
        <tr><td colspan="3" class="item-name">${esc(line.name)}</td></tr>
        <tr>
          <td>${qty} ${esc(line.unitCode)} x ${formatPaise(line.unitPricePaise, false)}</td>
          <td class="r">${line.totalDiscountPaise > 0 ? `-${formatPaise(line.totalDiscountPaise, false)}` : ''}</td>
          <td class="r b">${formatPaise(line.totalPaise, false)}</td>
        </tr>`;
    })
    .join('');

  const taxRows =
    settings.receipt.showGstBreakdown && bill.taxPaise > 0
      ? bill.taxBreakdown
          .filter((b) => b.taxPaise > 0)
          .map(
            (
              b,
            ) => `<tr><td>${bill.isInterstate ? 'IGST' : 'CGST+SGST'} ${(b.rateBp / 100).toFixed(0)}%</td>
                    <td class="r">${formatPaise(b.taxPaise, false)}</td></tr>`,
          )
          .join('')
      : '';

  const payments = receipt.payments
    .map(
      (p) =>
        `<tr><td>${esc(p.method.toUpperCase())}${p.reference ? ` ${esc(p.reference)}` : ''}</td>
         <td class="r">${formatPaise(p.amountPaise, false)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(receipt.invoiceNumber)}</title>
<style>${thermalStyles(PAPER_WIDTH[paperSize])}</style></head>
<body>
  ${isVoided ? `<div class="voided c">VOIDED — NOT VALID<br>${esc(receipt.voidReason)}</div>` : ''}
  ${input.isReprint ? '<div class="reprint c">REPRINT</div>' : ''}
  ${input.logoDataUrl ? `<img class="logo" src="${input.logoDataUrl}" alt="">` : ''}
  <div class="c shop">${esc(settings.shop.name)}</div>
  <div class="c">${shopHeaderLines(settings).map(esc).join('<br>')}</div>
  <div class="rule"></div>
  <div class="c b">${isTaxInvoice ? 'TAX INVOICE' : 'RECEIPT'}</div>
  <table>
    <tr><td>No:</td><td class="r b">${esc(receipt.invoiceNumber)}</td></tr>
    <tr><td>Date:</td><td class="r">${formatDateTime(receipt.invoiceDate)}</td></tr>
    ${receipt.customerName ? `<tr><td>Customer:</td><td class="r">${esc(receipt.customerName)}</td></tr>` : ''}
    ${receipt.customerGstin ? `<tr><td>GSTIN:</td><td class="r">${esc(receipt.customerGstin)}</td></tr>` : ''}
  </table>
  <div class="rule"></div>
  <table>${items}</table>
  <div class="rule"></div>
  <table class="totals">
    ${
      bill.itemDiscountPaise + bill.cartDiscountPaise > 0
        ? `<tr><td>Gross</td><td class="r">${formatPaise(bill.grossPaise, false)}</td></tr>
           <tr><td>Discount</td><td class="r">-${formatPaise(bill.itemDiscountPaise + bill.cartDiscountPaise, false)}</td></tr>`
        : ''
    }
    <tr><td>Taxable</td><td class="r">${formatPaise(bill.taxablePaise, false)}</td></tr>
    ${taxRows}
    ${bill.roundOffPaise !== 0 ? `<tr><td>Round off</td><td class="r">${bill.roundOffPaise > 0 ? '+' : '-'}${formatPaise(Math.abs(bill.roundOffPaise), false)}</td></tr>` : ''}
    <tr class="grand"><td>TOTAL</td><td class="r">${formatPaise(bill.totalPaise, false)}</td></tr>
  </table>
  <div class="rule"></div>
  <table>
    ${payments}
    ${receipt.changePaise > 0 ? `<tr><td>Change</td><td class="r b">${formatPaise(receipt.changePaise, false)}</td></tr>` : ''}
  </table>
  ${loyaltyLines(input) ? `<div class="rule"></div><div class="c">${esc(loyaltyLines(input))}</div>` : ''}
  ${settings.receipt.footerText ? `<div class="c foot">${esc(settings.receipt.footerText)}</div>` : ''}
  <div class="c foot">Thank you</div>
</body></html>`;
}

function renderA4(input: ReceiptRenderInput): string {
  const { receipt, settings } = input;
  const bill = receipt.bill;
  const isTaxInvoice = Boolean(settings.shop.gstin);
  const isVoided = receipt.status === 'voided';
  const interstate = bill.isInterstate;

  const rows = bill.lines
    .map((line) => {
      const precision = precisionFor(line.unitCode);
      return `<tr>
        <td>${line.lineNo}</td>
        <td>${esc(line.name)}${line.sku ? `<br><span class="muted">${esc(line.sku)}</span>` : ''}</td>
        <td>${esc(line.hsn ?? '')}</td>
        <td class="num">${formatQuantity(line.quantityMilli, precision)} ${esc(line.unitCode)}</td>
        <td class="num">${formatPaise(line.unitPricePaise, false)}</td>
        <td class="num">${line.totalDiscountPaise > 0 ? formatPaise(line.totalDiscountPaise, false) : '—'}</td>
        <td class="num">${formatPaise(line.taxablePaise, false)}</td>
        <td class="num">${(line.taxRateBp / 100).toFixed(0)}%</td>
        <td class="num">${formatPaise(line.taxPaise, false)}</td>
        <td class="num">${formatPaise(line.totalPaise, false)}</td>
      </tr>`;
    })
    .join('');

  const gstTable =
    settings.receipt.showGstBreakdown && bill.taxPaise > 0
      ? `<table class="gst">
          <thead><tr><th>Rate</th><th>Taxable</th>${
            interstate ? '<th>IGST</th>' : '<th>CGST</th><th>SGST</th>'
          }</tr></thead>
          <tbody>${bill.taxBreakdown
            .filter((b) => b.taxPaise > 0)
            .map(
              (b) => `<tr>
                <td>${(b.rateBp / 100).toFixed(0)}%</td>
                <td class="num">${formatPaise(b.taxablePaise, false)}</td>
                ${
                  interstate
                    ? `<td class="num">${formatPaise(b.igstPaise, false)}</td>`
                    : `<td class="num">${formatPaise(b.cgstPaise, false)}</td><td class="num">${formatPaise(b.sgstPaise, false)}</td>`
                }
              </tr>`,
            )
            .join('')}</tbody>
        </table>`
      : '';

  const payments = receipt.payments
    .map(
      (p) =>
        `<tr><td>${esc(p.method.toUpperCase())}${p.reference ? ` · ${esc(p.reference)}` : ''}</td>
         <td class="num">${formatPaise(p.amountPaise, false)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(receipt.invoiceNumber)}</title>
<style>${a4Styles()}</style></head>
<body>
  ${isVoided ? `<div class="voided">VOIDED — NOT A VALID INVOICE · ${esc(receipt.voidReason)}</div>` : ''}
  ${input.isReprint ? '<div class="reprint">REPRINT</div>' : ''}
  <div class="head">
    <div>
      <p class="shop-name">${esc(settings.shop.name)}</p>
      <div class="muted">${shopHeaderLines(settings).map(esc).join('<br>')}</div>
    </div>
    ${input.logoDataUrl ? `<img class="logo" src="${input.logoDataUrl}" alt="">` : ''}
  </div>

  <div class="title">${isTaxInvoice ? 'Tax Invoice' : 'Receipt'}</div>

  <div class="meta">
    <div>
      <div class="label">Billed to</div>
      <div>${esc(receipt.customerName ?? 'Walk-in Customer')}</div>
      ${receipt.customerGstin ? `<div class="muted">GSTIN: ${esc(receipt.customerGstin)}</div>` : ''}
    </div>
    <div class="num">
      <div class="label">Invoice</div>
      <div><strong>${esc(receipt.invoiceNumber)}</strong></div>
      <div class="muted">${formatDateTime(receipt.invoiceDate)}</div>
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th>#</th><th>Description</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th>
      <th class="num">Disc</th><th class="num">Taxable</th><th class="num">GST</th>
      <th class="num">Tax</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div>
      ${gstTable}
      <table class="gst" style="margin-top:10px">
        <thead><tr><th colspan="2">Payment</th></tr></thead>
        <tbody>
          ${payments}
          ${receipt.changePaise > 0 ? `<tr><td>Change given</td><td class="num">${formatPaise(receipt.changePaise, false)}</td></tr>` : ''}
          ${loyaltyLines(input) ? `<tr><td colspan="2">${esc(loyaltyLines(input))}</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <table class="totals">
      ${
        bill.itemDiscountPaise + bill.cartDiscountPaise > 0
          ? `<tr><td>Gross value</td><td class="num">${formatPaise(bill.grossPaise, false)}</td></tr>
             <tr><td>Less discount</td><td class="num">-${formatPaise(bill.itemDiscountPaise + bill.cartDiscountPaise, false)}</td></tr>`
          : ''
      }
      <tr><td>Taxable value</td><td class="num">${formatPaise(bill.taxablePaise, false)}</td></tr>
      ${
        interstate
          ? `<tr><td>IGST</td><td class="num">${formatPaise(bill.igstPaise, false)}</td></tr>`
          : `<tr><td>CGST</td><td class="num">${formatPaise(bill.cgstPaise, false)}</td></tr>
             <tr><td>SGST</td><td class="num">${formatPaise(bill.sgstPaise, false)}</td></tr>`
      }
      ${bill.roundOffPaise !== 0 ? `<tr><td>Round off</td><td class="num">${bill.roundOffPaise > 0 ? '+' : '-'}${formatPaise(Math.abs(bill.roundOffPaise), false)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="num">${formatPaise(bill.totalPaise, false)}</td></tr>
    </table>
  </div>

  <div class="foot">
    ${settings.receipt.footerText ? `${esc(settings.receipt.footerText)}<br>` : ''}
    This is a computer-generated document.
  </div>
</body></html>`;
}

/**
 * The points line, when the shop runs them and this bill moved any. Printed
 * from what was stored with the sale, so a reprint shows what the customer was
 * actually told at the counter.
 */
function loyaltyLines(input: ReceiptRenderInput): string {
  const { receipt, settings } = input;
  const loyalty = receipt.loyalty;
  if (!loyalty || !settings.loyalty.enabled || !settings.loyalty.showOnReceipt) return '';

  const parts: string[] = [];
  if (loyalty.pointsRedeemed > 0) parts.push(`${loyalty.pointsRedeemed} points used`);
  if (loyalty.pointsEarned > 0) parts.push(`${loyalty.pointsEarned} points earned`);
  parts.push(`Balance ${loyalty.balancePoints}`);
  return parts.join(' · ');
}

export function buildReceiptHtml(input: ReceiptRenderInput): string {
  return input.paperSize === 'a4' ? renderA4(input) : renderThermal(input);
}
