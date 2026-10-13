/**
 * Reports.
 *
 * Each report is assembled here into the one table shape the renderer and the
 * CSV export both consume. Definitions are documented in `docs/reports.md` and
 * applied in `ReportsRepository`; this layer decides columns, totals and the
 * caveats a reader needs to see next to the numbers.
 */
import type { Database } from 'better-sqlite3';
import {
  REPORT_LABELS,
  SNAPSHOT_REPORTS,
  reportQuerySchema,
  type ReportColumn,
  type ReportQuery,
  type ReportRow,
  type ReportTable,
} from '@shared/reports';
import { formatQuantity, precisionFor } from '@shared/quantity';
import { ReportsRepository, type Range } from '../db/repositories/reports';
import { InventoryRepository } from '../db/repositories/inventory';
import { now } from '../db/repositories/base';
import { loadBranchContext } from './branch-context';

export class ReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

const money = (key: string, label: string): ReportColumn => ({ key, label, format: 'money' });
const text = (key: string, label: string): ReportColumn => ({ key, label, format: 'text' });
const int = (key: string, label: string): ReportColumn => ({ key, label, format: 'int' });

/**
 * Estimated profit for one product line of the report: ex-tax value net of
 * returns, less today's cost price for the units kept. Both the product report
 * and the sales summary read it from here, so they cannot disagree.
 */
const profitOf = (row: {
  taxable: number;
  returned_taxable: number;
  cost_paise: number | null;
  qty: number;
  returned_qty: number;
}): number =>
  row.taxable -
  row.returned_taxable -
  Math.round(((row.cost_paise ?? 0) * (row.qty - row.returned_qty)) / 1000);

const qty = (milli: number, unitCode: string): string =>
  `${formatQuantity(milli, precisionFor(unitCode))} ${unitCode}`;

/** `2026-10-13` as the shop writes it. */
const dayLabel = (isoDay: string): string => {
  const [y, m, d] = isoDay.split('-');
  return y && m && d ? `${d}/${m}/${y}` : isoDay;
};

const dateTimeLabel = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const rangeLabel = (range: Range): string =>
  `${dateTimeLabel(range.fromIso)} to ${dateTimeLabel(range.toIso)}`;

export class ReportService {
  private readonly repo: ReportsRepository;
  private readonly inventory: InventoryRepository;

  constructor(db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new ReportError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.repo = new ReportsRepository(db, ctx.companyId);
    this.inventory = new InventoryRepository(db, ctx.companyId);
  }

  run(input: unknown): ReportTable {
    const query: ReportQuery = reportQuerySchema.parse(input ?? {});
    const needsRange = !SNAPSHOT_REPORTS.includes(query.kind);

    if (needsRange && (!query.fromIso || !query.toIso)) {
      throw new ReportError('RANGE_REQUIRED', 'Choose a date range for this report.');
    }

    const range: Range = {
      fromIso: query.fromIso ?? new Date(0).toISOString(),
      toIso: query.toIso ?? now(),
    };

    const table = this.build(query, range);
    return { ...table, generatedAt: now() };
  }

  private build(query: ReportQuery, range: Range): Omit<ReportTable, 'generatedAt'> {
    const title = REPORT_LABELS[query.kind];
    const subtitle = SNAPSHOT_REPORTS.includes(query.kind)
      ? `As at ${dateTimeLabel(now())}`
      : rangeLabel(range);
    const base = { kind: query.kind, title, subtitle };

    switch (query.kind) {
      case 'sales-summary':
        return { ...base, ...this.salesSummary(range) };
      case 'daily-sales':
        return { ...base, ...this.dailySales(range) };
      case 'product-wise':
        return { ...base, ...this.productWise(range) };
      case 'category-wise':
        return { ...base, ...this.categoryWise(range) };
      case 'payment-methods':
        return { ...base, ...this.paymentMethods(range) };
      case 'tax-summary':
        return { ...base, ...this.taxSummary(range) };
      case 'discount-summary':
        return { ...base, ...this.discounts(range) };
      case 'returns':
        return { ...base, ...this.returns(range) };
      case 'purchases':
        return { ...base, ...this.purchases(range) };
      case 'purchase-returns':
        return { ...base, ...this.purchaseReturns(range) };
      case 'supplier-outstanding':
        return { ...base, ...this.supplierOutstanding() };
      case 'stock-on-hand':
        return { ...base, ...this.stockOnHand() };
      case 'stock-movement':
        return { ...base, ...this.stockMovements(range) };
      case 'low-stock':
        return { ...base, ...this.lowStock() };
    }
  }

  // ─── Sales ────────────────────────────────────────────────────────────────

  private salesSummary(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const s = this.repo.salesSummary(range);
    const returns = this.repo.returnsTotal(range);
    const profit = this.repo.productWise(range).reduce((a, row) => a + profitOf(row), 0);

    const rows: ReportRow[] = [
      { metric: 'Invoices', count: s.invoices, value: null },
      { metric: 'Items billed', count: s.lines, value: null },
      { metric: 'Gross', count: null, value: s.gross },
      { metric: 'Discounts', count: null, value: -s.discount },
      { metric: 'Taxable', count: null, value: s.taxable },
      { metric: 'CGST', count: null, value: s.cgst },
      { metric: 'SGST', count: null, value: s.sgst },
      { metric: 'IGST', count: null, value: s.igst },
      { metric: 'Round off', count: null, value: s.round_off },
      { metric: 'Sales total', count: null, value: s.total },
      { metric: 'Returns', count: returns.count, value: -returns.total },
      { metric: 'Net takings', count: null, value: s.total - returns.total },
      { metric: 'Estimated gross profit', count: null, value: profit },
    ];

    return {
      columns: [text('metric', 'Measure'), int('count', 'Count'), money('value', 'Amount')],
      rows,
      totals: null,
      note:
        'Voided invoices are excluded. Estimated gross profit uses each product\u2019s ' +
        'current cost price, so it is an estimate, not a costed figure.',
    };
  }

  private dailySales(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const days = this.repo.dailySales(range);

    const rows: ReportRow[] = days.map((d) => ({
      day: dayLabel(d.day),
      invoices: d.invoices,
      gross: d.gross,
      discount: d.discount,
      taxable: d.taxable,
      tax: d.tax,
      total: d.total,
      returns: d.returns,
      net: d.total - d.returns,
    }));

    const sum = (pick: (d: (typeof days)[number]) => number) =>
      days.reduce((a, d) => a + pick(d), 0);

    return {
      columns: [
        text('day', 'Day'),
        int('invoices', 'Invoices'),
        money('gross', 'Gross'),
        money('discount', 'Discount'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Sales'),
        money('returns', 'Returns'),
        money('net', 'Net'),
      ],
      rows,
      totals: {
        day: 'Total',
        invoices: sum((d) => d.invoices),
        gross: sum((d) => d.gross),
        discount: sum((d) => d.discount),
        taxable: sum((d) => d.taxable),
        tax: sum((d) => d.tax),
        total: sum((d) => d.total),
        returns: sum((d) => d.returns),
        net: sum((d) => d.total) - sum((d) => d.returns),
      },
      note: 'Days are the shop’s local days. A return counts on the day the credit note was raised.',
    };
  }

  private productWise(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const products = this.repo.productWise(range);

    const rows: ReportRow[] = products.map((p) => {
      return {
        name: p.name,
        sku: p.sku,
        qty: qty(p.qty, p.unit_code),
        returnedQty: p.returned_qty > 0 ? qty(p.returned_qty, p.unit_code) : '—',
        discount: p.discount,
        taxable: p.taxable,
        tax: p.tax,
        total: p.total,
        returned: p.returned_total,
        profit: profitOf(p),
      };
    });

    const sum = (pick: (r: ReportRow) => number) =>
      rows.reduce((a, r) => a + ((pick(r) as number) ?? 0), 0);

    return {
      columns: [
        text('name', 'Product'),
        text('sku', 'SKU'),
        text('qty', 'Sold'),
        text('returnedQty', 'Returned'),
        money('discount', 'Discount'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Sales'),
        money('returned', 'Credited'),
        money('profit', 'Est. profit'),
      ],
      rows,
      totals: {
        name: 'Total',
        sku: '',
        qty: '',
        returnedQty: '',
        discount: sum((r) => r['discount'] as number),
        taxable: sum((r) => r['taxable'] as number),
        tax: sum((r) => r['tax'] as number),
        total: sum((r) => r['total'] as number),
        returned: sum((r) => r['returned'] as number),
        profit: sum((r) => r['profit'] as number),
      },
      note:
        'Estimated profit is taxable value net of returns, less the product’s current ' +
        'cost price. A product sold before its cost was last edited is costed at today’s figure.',
    };
  }

  private categoryWise(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const categories = this.repo.categoryWise(range);

    const rows: ReportRow[] = categories.map((c) => ({
      category: c.category,
      lines: c.lines,
      taxable: c.taxable,
      tax: c.tax,
      total: c.total,
      profit: c.taxable - Math.round(c.cost),
    }));

    const sum = (pick: (c: (typeof categories)[number]) => number) =>
      categories.reduce((a, c) => a + pick(c), 0);

    return {
      columns: [
        text('category', 'Category'),
        int('lines', 'Lines'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Sales'),
        money('profit', 'Est. profit'),
      ],
      rows,
      totals: {
        category: 'Total',
        lines: sum((c) => c.lines),
        taxable: sum((c) => c.taxable),
        tax: sum((c) => c.tax),
        total: sum((c) => c.total),
        profit: sum((c) => c.taxable) - Math.round(sum((c) => c.cost)),
      },
      note: 'Returns are not deducted here; see the returns report. Profit is an estimate.',
    };
  }

  private paymentMethods(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const methods = this.repo.paymentMethods(range);

    const rows: ReportRow[] = methods.map((m) => ({
      method: m.method.toUpperCase(),
      count: m.count,
      collected: m.collected,
      refunded: m.refunded,
      net: m.collected - m.refunded,
    }));

    const sum = (pick: (m: (typeof methods)[number]) => number) =>
      methods.reduce((a, m) => a + pick(m), 0);

    return {
      columns: [
        text('method', 'Method'),
        int('count', 'Payments'),
        money('collected', 'Collected'),
        money('refunded', 'Refunded'),
        money('net', 'Net'),
      ],
      rows,
      totals: {
        method: 'Total',
        count: sum((m) => m.count),
        collected: sum((m) => m.collected),
        refunded: sum((m) => m.refunded),
        net: sum((m) => m.collected) - sum((m) => m.refunded),
      },
      note: 'Cash is net of change given, so this is what stayed in the till.',
    };
  }

  private taxSummary(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const rates = this.repo.taxSummary(range);

    const rows: ReportRow[] = rates.map((r) => ({
      rate: `${(r.rate_bp / 100).toFixed(r.rate_bp % 100 === 0 ? 0 : 2)}%`,
      taxable: r.taxable,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      tax: r.tax,
    }));

    const sum = (pick: (r: (typeof rates)[number]) => number) =>
      rates.reduce((a, r) => a + pick(r), 0);

    return {
      columns: [
        text('rate', 'Rate'),
        money('taxable', 'Taxable'),
        money('cgst', 'CGST'),
        money('sgst', 'SGST'),
        money('igst', 'IGST'),
        money('tax', 'Total tax'),
      ],
      rows,
      totals: {
        rate: 'Total',
        taxable: sum((r) => r.taxable),
        cgst: sum((r) => r.cgst),
        sgst: sum((r) => r.sgst),
        igst: sum((r) => r.igst),
        tax: sum((r) => r.tax),
      },
      note: 'Net of credit notes raised in the same range, which is the basis a GST return needs.',
    };
  }

  private discounts(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const days = this.repo.discounts(range);

    const rows: ReportRow[] = days.map((d) => ({
      day: dayLabel(d.day),
      invoices: d.invoices,
      gross: d.gross,
      item: d.item_discount,
      cart: d.cart_discount,
      total: d.item_discount + d.cart_discount,
      share: d.gross > 0 ? Math.round(((d.item_discount + d.cart_discount) / d.gross) * 10000) : 0,
    }));

    const sum = (pick: (d: (typeof days)[number]) => number) =>
      days.reduce((a, d) => a + pick(d), 0);
    const grossTotal = sum((d) => d.gross);
    const discountTotal = sum((d) => d.item_discount + d.cart_discount);

    return {
      columns: [
        text('day', 'Day'),
        int('invoices', 'Invoices'),
        money('gross', 'Gross'),
        money('item', 'Item discount'),
        money('cart', 'Bill discount'),
        money('total', 'Total discount'),
        { key: 'share', label: 'Share of gross', format: 'percent' },
      ],
      rows,
      totals: {
        day: 'Total',
        invoices: sum((d) => d.invoices),
        gross: grossTotal,
        item: sum((d) => d.item_discount),
        cart: sum((d) => d.cart_discount),
        total: discountTotal,
        share: grossTotal > 0 ? Math.round((discountTotal / grossTotal) * 10000) : 0,
      },
      note: null,
    };
  }

  private returns(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const list = this.repo.returnsList(range);

    const rows: ReportRow[] = list.map((r) => ({
      number: r.return_number,
      date: dateTimeLabel(r.return_date),
      invoice: r.invoice_number,
      lines: r.lines,
      restocked: `${r.restocked_lines} of ${r.lines}`,
      taxable: r.taxable,
      tax: r.tax,
      total: r.total,
      method: r.refund_method.toUpperCase(),
    }));

    const sum = (pick: (r: (typeof list)[number]) => number) =>
      list.reduce((a, r) => a + pick(r), 0);

    return {
      columns: [
        text('number', 'Credit note'),
        text('date', 'Date'),
        text('invoice', 'Against invoice'),
        int('lines', 'Lines'),
        text('restocked', 'Restocked'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Refunded'),
        text('method', 'Method'),
      ],
      rows,
      totals: {
        number: 'Total',
        date: '',
        invoice: '',
        lines: sum((r) => r.lines),
        restocked: '',
        taxable: sum((r) => r.taxable),
        tax: sum((r) => r.tax),
        total: sum((r) => r.total),
        method: '',
      },
      note: 'Restocked counts the lines the operator marked resaleable.',
    };
  }

  // ─── Buying ───────────────────────────────────────────────────────────────

  private purchases(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const list = this.repo.purchases(range);

    const rows: ReportRow[] = list.map((p) => ({
      number: p.purchase_number,
      date: dateTimeLabel(p.purchase_date),
      supplierBill: p.supplier_bill_no,
      supplier: p.supplier_name,
      lines: p.lines,
      taxable: p.taxable,
      tax: p.tax,
      total: p.total,
      paid: p.paid,
      owed: p.total - p.returned - p.paid,
    }));

    const sum = (pick: (p: (typeof list)[number]) => number) =>
      list.reduce((a, p) => a + pick(p), 0);

    return {
      columns: [
        text('number', 'Purchase'),
        text('date', 'Date'),
        text('supplierBill', 'Their bill'),
        text('supplier', 'Supplier'),
        int('lines', 'Lines'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Total'),
        money('paid', 'Paid'),
        money('owed', 'Still owed'),
      ],
      rows,
      totals: {
        number: 'Total',
        date: '',
        supplierBill: '',
        supplier: '',
        lines: sum((p) => p.lines),
        taxable: sum((p) => p.taxable),
        tax: sum((p) => p.tax),
        total: sum((p) => p.total),
        paid: sum((p) => p.paid),
        owed: sum((p) => p.total - p.returned - p.paid),
      },
      note: 'Cancelled purchases are excluded. Tax here is input credit, not a cost.',
    };
  }

  private purchaseReturns(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const list = this.repo.purchaseReturns(range);

    const rows: ReportRow[] = list.map((r) => ({
      number: r.return_number,
      date: dateTimeLabel(r.return_date),
      purchase: r.purchase_number,
      supplier: r.supplier_name,
      lines: r.lines,
      taxable: r.taxable,
      tax: r.tax,
      total: r.total,
      settlement: r.settlement === 'debit_note' ? 'Debit note' : r.settlement.toUpperCase(),
    }));

    const sum = (pick: (r: (typeof list)[number]) => number) =>
      list.reduce((a, r) => a + pick(r), 0);

    return {
      columns: [
        text('number', 'Debit note'),
        text('date', 'Date'),
        text('purchase', 'Against purchase'),
        text('supplier', 'Supplier'),
        int('lines', 'Lines'),
        money('taxable', 'Taxable'),
        money('tax', 'Tax'),
        money('total', 'Value'),
        text('settlement', 'Settled by'),
      ],
      rows,
      totals: {
        number: 'Total',
        date: '',
        purchase: '',
        supplier: '',
        lines: sum((r) => r.lines),
        taxable: sum((r) => r.taxable),
        tax: sum((r) => r.tax),
        total: sum((r) => r.total),
        settlement: '',
      },
      note: 'A debit note stays on the supplier account; anything else means money came back.',
    };
  }

  private supplierOutstanding(): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const list = this.repo.supplierOutstanding();

    const rows: ReportRow[] = list.map((s) => ({
      supplier: s.name,
      phone: s.phone,
      lastPurchase: s.last_purchase_at ? dateTimeLabel(s.last_purchase_at) : '—',
      purchased: s.purchased,
      returned: s.returned,
      paid: s.paid,
      owed: s.owed,
    }));

    const sum = (pick: (s: (typeof list)[number]) => number) =>
      list.reduce((a, s) => a + pick(s), 0);

    return {
      columns: [
        text('supplier', 'Supplier'),
        text('phone', 'Phone'),
        text('lastPurchase', 'Last purchase'),
        money('purchased', 'Purchased'),
        money('returned', 'Returned'),
        money('paid', 'Paid'),
        money('owed', 'Still owed'),
      ],
      rows,
      totals: {
        supplier: 'Total',
        phone: '',
        lastPurchase: '',
        purchased: sum((s) => s.purchased),
        returned: sum((s) => s.returned),
        paid: sum((s) => s.paid),
        owed: sum((s) => s.owed),
      },
      note: 'Everything bought since the shop opened, less returns and payments. A negative figure means the supplier owes us.',
    };
  }

  // ─── Stock ────────────────────────────────────────────────────────────────

  private stockOnHand(): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const stock = this.repo.stockOnHand();

    const rows: ReportRow[] = stock.map((p) => ({
      name: p.name,
      sku: p.sku,
      stock: qty(p.stock_milli, p.unit_code),
      cost: Math.round((p.cost_paise * p.stock_milli) / 1000),
      retail: Math.round((p.price_paise * p.stock_milli) / 1000),
    }));

    const sum = (key: 'cost' | 'retail') => rows.reduce((a, r) => a + (r[key] as number), 0);

    return {
      columns: [
        text('name', 'Product'),
        text('sku', 'SKU'),
        text('stock', 'In stock'),
        money('cost', 'At cost'),
        money('retail', 'At retail'),
      ],
      rows,
      totals: { name: 'Total', sku: '', stock: '', cost: sum('cost'), retail: sum('retail') },
      note: 'Active products with stock tracking only. Values use today’s cost and selling price.',
    };
  }

  private stockMovements(range: Range): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const movements = this.repo.stockMovements(range);

    const rows: ReportRow[] = movements.map((m) => ({
      when: dateTimeLabel(m.created_at),
      product: m.product_name,
      type: m.movement_type.replace('_', ' '),
      document: m.document_number,
      change: `${m.quantity_milli > 0 ? '+' : '−'}${qty(Math.abs(m.quantity_milli), m.unit_code)}`,
      reason: m.reason,
    }));

    return {
      columns: [
        text('when', 'When'),
        text('product', 'Product'),
        text('type', 'Movement'),
        text('document', 'Document'),
        text('change', 'Change'),
        text('reason', 'Reason'),
      ],
      rows,
      totals: null,
      note: 'Every change to stock, in the order it happened. Quantities cannot be netted across units.',
    };
  }

  private lowStock(): Pick<ReportTable, 'columns' | 'rows' | 'totals' | 'note'> {
    const low = this.inventory.lowStock(500);

    const rows: ReportRow[] = low.map((p) => ({
      name: p.name,
      sku: p.sku,
      stock: qty(p.stockMilli, p.unitCode),
      reorder: qty(p.reorderLevelMilli, p.unitCode),
      shortfall: qty(Math.max(0, p.reorderLevelMilli - p.stockMilli), p.unitCode),
    }));

    return {
      columns: [
        text('name', 'Product'),
        text('sku', 'SKU'),
        text('stock', 'In stock'),
        text('reorder', 'Reorder at'),
        text('shortfall', 'Short by'),
      ],
      rows,
      totals: null,
      note: 'Only products with a reorder level set. Worst shortfall first.',
    };
  }
}
