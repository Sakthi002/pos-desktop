/**
 * How a printed bill is dressed.
 *
 * A tax invoice has to show particular things in a particular order, so the
 * document itself is the same whichever theme a shop picks: the same markup,
 * the same figures, the same GST summary. A theme is the stylesheet over it,
 * and the shop's colour goes in at one place. That way a shop can have a bill
 * that looks like its own without anyone being able to design away a column
 * the law requires.
 */
import type { AppSettings, InvoiceTheme } from './settings';
import { qrSvg, upiLink } from './qr';

export const THEME_LABELS: Record<InvoiceTheme, string> = {
  classic: 'Classic',
  modern: 'Modern',
  compact: 'Compact',
  bordered: 'Bordered',
};

export const THEME_NOTES: Record<InvoiceTheme, string> = {
  classic: 'Plain rules and a boxed table. What a shop expects a bill to look like.',
  modern: 'A coloured band across the head, and lines instead of a grid.',
  compact: 'Smaller type and tighter rows, for bills that run long.',
  bordered: 'A frame around the sheet, with each part in its own box.',
};

/** Mixes the shop's colour with white, for the tints a theme needs. */
function tint(accent: string, amount: number): string {
  const value = accent.replace('#', '');
  const channel = (at: number): number => parseInt(value.slice(at, at + 2), 16);
  const mix = (c: number): number => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(channel(0))} ${mix(channel(2))} ${mix(channel(4))})`;
}

/**
 * The stylesheet for a theme. Appended after the shared styles, so each rule
 * here is a deliberate override of the plain document underneath.
 */
/** The pay code's own styles, the same under every theme. */
export function payCodeCss(): string {
  return `
    .paycode { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
    .paycode svg { display: block; }
    .paycode .label { font-weight: 700; color: #111; }
  `;
}

export function themeCss(settings: AppSettings): string {
  const { theme, accent } = settings.template;
  const pale = tint(accent, 0.88);
  const paler = tint(accent, 0.94);

  if (theme === 'modern')
    return `
    .head { background: ${accent}; color: #fff; padding: 10px 12px; border-radius: 3px; }
    .head .muted { color: rgb(255 255 255 / 85%); }
    .title { border: 0; color: ${accent}; letter-spacing: 0.18em; margin: 16px 0 10px; padding: 0; }
    table.items th { background: ${pale}; border: 0; border-bottom: 1.5px solid ${accent}; }
    table.items td { border: 0; border-bottom: 1px solid #e6e6ea; }
    table.gst th { background: ${pale}; border-color: ${pale}; }
    table.gst td { border-color: #e6e6ea; }
    table.totals tr.grand td { border-top: 1.5px solid ${accent}; color: ${accent}; }
    .foot { border-top: 1px solid ${pale}; }
  `;

  if (theme === 'compact')
    return `
    body { font-size: 9.5px; }
    .shop-name { font-size: 14px; }
    .logo { max-height: 16mm; }
    .title { font-size: 11px; margin: 9px 0 7px; padding: 3px; }
    table.items th, table.items td { padding: 2.5px 4px; }
    table.items th { background: ${paler}; }
    table.totals td { padding: 2px 6px; }
    table.totals tr.grand td { font-size: 12px; border-top-color: ${accent}; }
    .foot { margin-top: 12px; padding-top: 6px; font-size: 9px; }
  `;

  if (theme === 'bordered')
    return `
    body { border: 2px solid ${accent}; }
    /* The frame belongs to the sheet, not to the text: without a height it
       would stop wherever the bill happens to end, halfway up the page. */
    @media print { body { min-height: calc(297mm - 28mm); } }
    .head { border-bottom: 1px solid ${accent}; padding-bottom: 8px; }
    .title { border-top: 3px double ${accent}; border-bottom: 3px double ${accent}; }
    .meta { border: 1px solid #ddd; padding: 7px 9px; }
    table.items th { background: ${pale}; }
    table.items th, table.items td { border-color: ${tint(accent, 0.6)}; }
    table.totals { border: 1px solid ${tint(accent, 0.6)}; }
    table.totals tr.grand td { border-top-color: ${accent}; }
    .terms, .bank { border: 1px solid #ddd; padding: 6px 8px; }
  `;

  // Classic: the plain document, with the shop's colour on the lines that
  // carry weight. Anything louder is what the other themes are for.
  return `
    .title { border-color: ${accent}; }
    table.items th { background: ${paler}; }
    table.totals tr.grand td { border-top-color: ${accent}; }
  `;
}

/**
 * The code a customer scans to pay. Drawn only when the shop has given a UPI
 * handle and the bill has something to collect — a code on a bill that is
 * already paid invites a second payment.
 */
function payCode(
  settings: AppSettings,
  amountPaise: number,
  reference: string,
  escape: (v: string) => string,
): string {
  const upi = settings.template.upiId;
  if (!upi || amountPaise <= 0) return '';

  const link = upiLink({
    vpa: upi,
    payee: settings.shop.name,
    amountPaise,
    note: reference,
  });

  return `<div class="paycode">
    ${qrSvg(link, 26)}
    <span class="label">Scan to pay</span>
    <span class="muted">${escape(upi)}</span>
  </div>`;
}

/** The blocks a shop can add at the foot of an A4 bill. */
export function footBlocks(
  settings: AppSettings,
  escape: (v: string) => string,
  pay?: { amountPaise: number; reference: string },
): string {
  const { template, shop } = settings;
  const parts: string[] = [];

  if (pay) {
    const code = payCode(settings, pay.amountPaise, pay.reference, escape);
    if (code) parts.push(code);
  }

  if (template.bankDetails)
    parts.push(`<div class="bank"><span class="label">Payment details</span>
      <div>${escape(template.bankDetails).replace(/\n/g, '<br>')}</div></div>`);

  if (template.terms)
    parts.push(`<div class="terms"><span class="label">Terms</span>
      <div>${escape(template.terms).replace(/\n/g, '<br>')}</div></div>`);

  if (template.showSignature)
    parts.push(`<div class="sign"><span>For ${escape(template.signatureLabel || shop.name)}</span></div>`);

  return parts.length > 0 ? `<div class="extras">${parts.join('')}</div>` : '';
}
