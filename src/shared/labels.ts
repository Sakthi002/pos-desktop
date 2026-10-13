import { z } from 'zod';
import { barcodeSvg, canEncode } from './barcode';
import { formatPaise } from './money';
import { PRICE_LEVELS, priceAt, type PriceLevel } from './trade';
import type { AppSettings } from './settings';

/**
 * Shelf and product labels, laid out for a sheet of sticker paper.
 *
 * Built as HTML and printed through the same printer path receipts use, so
 * there is one way to put ink on paper in this app. Sizes are in millimetres
 * because that is what a sheet of labels is sold in.
 */

export const LABEL_SHEETS = ['a4-40', 'a4-24', 'a4-12'] as const;
export type LabelSheet = (typeof LABEL_SHEETS)[number];

interface SheetSpec {
  label: string;
  columns: number;
  rows: number;
  widthMm: number;
  heightMm: number;
}

export const SHEET_SPECS: Record<LabelSheet, SheetSpec> = {
  'a4-40': { label: '40 per sheet (48 × 25 mm)', columns: 4, rows: 10, widthMm: 48, heightMm: 25 },
  'a4-24': { label: '24 per sheet (64 × 34 mm)', columns: 3, rows: 8, widthMm: 64, heightMm: 34 },
  'a4-12': { label: '12 per sheet (96 × 50 mm)', columns: 2, rows: 6, widthMm: 96, heightMm: 50 },
};

export const labelRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /** How many stickers of this product to print. */
        count: z.number().int().min(1).max(200),
      }),
    )
    .min(1, 'Choose at least one product'),
  sheet: z.enum(LABEL_SHEETS).default('a4-40'),
  priceLevel: z.enum(PRICE_LEVELS).default('retail'),
  showPrice: z.boolean().default(true),
  showMrp: z.boolean().default(false),
  /** Skips cells on the first sheet, so a part-used sheet is not wasted. */
  skip: z.number().int().min(0).max(100).default(0),
});

export type LabelRequest = z.infer<typeof labelRequestSchema>;

export interface LabelProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  pricePaise: number;
  mrpPaise: number | null;
  wholesalePricePaise: number | null;
  specialPricePaise: number | null;
  unitCode: string;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * What goes under the barcode: a shop scans the barcode if it has one, and
 * types the SKU if it does not. A product with neither still gets a label with
 * its name and price, which is what a shelf edge needs.
 */
const codeFor = (product: LabelProduct): string | null => {
  const code = product.barcode?.trim() || product.sku?.trim() || null;
  return code && canEncode(code) ? code : null;
};

export function buildLabelsHtml(input: {
  request: LabelRequest;
  products: LabelProduct[];
  settings: AppSettings;
}): string {
  const spec = SHEET_SPECS[input.request.sheet];
  const byId = new Map(input.products.map((p) => [p.id, p]));

  const cells: string[] = [];
  for (let i = 0; i < input.request.skip; i += 1) cells.push('<div class="cell blank"></div>');

  for (const item of input.request.items) {
    const product = byId.get(item.productId);
    if (!product) continue;

    const code = codeFor(product);
    const price = priceAt(input.request.priceLevel as PriceLevel, product);

    const body =
      `<div class="name">${esc(product.name)}</div>` +
      (code
        ? `<div class="bars">${barcodeSvg(code, {
            widthMm: spec.widthMm - 8,
            heightMm: Math.max(8, spec.heightMm / 2.6),
          })}</div><div class="code">${esc(code)}</div>`
        : `<div class="code">${esc(product.sku ?? '')}</div>`) +
      (input.request.showPrice
        ? `<div class="price">${formatPaise(price)}${
            input.request.showMrp && product.mrpPaise && product.mrpPaise !== price
              ? `<span class="mrp">MRP ${formatPaise(product.mrpPaise)}</span>`
              : ''
          }</div>`
        : '');

    for (let n = 0; n < item.count; n += 1) cells.push(`<div class="cell">${body}</div>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Manrope', system-ui, sans-serif;
    -webkit-print-color-adjust: exact;
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${spec.columns}, ${spec.widthMm}mm);
    grid-auto-rows: ${spec.heightMm}mm;
    gap: 2mm;
  }
  .cell {
    border: 0.2mm dashed #ccc;
    padding: 1.5mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6mm;
    overflow: hidden;
    text-align: center;
  }
  .cell.blank { border-color: transparent; }
  .name {
    font-size: ${spec.heightMm > 30 ? '3.6mm' : '2.8mm'};
    font-weight: 700;
    line-height: 1.15;
    max-height: 7mm;
    overflow: hidden;
  }
  .bars svg { display: block; }
  .code { font-family: ui-monospace, monospace; font-size: 2.4mm; letter-spacing: 0.2mm; }
  .price { font-size: ${spec.heightMm > 30 ? '5mm' : '4mm'}; font-weight: 800; }
  .mrp {
    display: block;
    font-size: 2.4mm;
    font-weight: 500;
    text-decoration: line-through;
    opacity: 0.6;
  }
</style></head>
<body><div class="sheet">${cells.join('')}</div></body></html>`;
}
