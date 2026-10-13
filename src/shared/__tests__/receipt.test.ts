import { describe, it, expect } from 'vitest';
import { buildReceiptHtml } from '../receipt';
import { defaultSettings, type AppSettings } from '../settings';
import { calculateBill } from '../billing';
import type { SaleReceipt } from '../sale';

const settings = (overrides: Partial<AppSettings['shop']> = {}): AppSettings => {
  const base = defaultSettings('Sharma General Store');
  return {
    ...base,
    shop: {
      ...base.shop,
      stateCode: '33',
      address: '14 Mettupalayam Road',
      phone: '9876543210',
      ...overrides,
    },
    receipt: { ...base.receipt, footerText: 'Goods once sold are not returnable.' },
  };
};

const makeReceipt = (interstate = false): SaleReceipt => {
  const bill = calculateBill({
    lines: [
      {
        productId: 'p1',
        name: 'Basmati Rice, 5kg',
        sku: 'RICE5',
        barcode: '8901234567890',
        hsn: '1006',
        unitCode: 'pc',
        quantityMilli: 2000,
        unitPricePaise: 49900,
        taxRateBp: 500,
        taxInclusive: true,
        discountPaise: 0,
      },
      {
        productId: 'p2',
        name: 'Sugar',
        sku: 'SUGAR',
        barcode: null,
        hsn: '1701',
        unitCode: 'kg',
        quantityMilli: 1500,
        unitPricePaise: 4500,
        taxRateBp: 500,
        taxInclusive: true,
        discountPaise: 0,
      },
    ],
    cartDiscountPaise: 0,
    isInterstate: interstate,
    roundTotal: true,
  });

  return {
    id: 'sale-1',
    invoiceNumber: 'SGS-1001',
    invoiceDate: '2026-10-12T09:30:00.000Z',
    financialYear: '2026-27',
    customerId: 'c1',
    customerName: 'Ravi & Sons',
    customerGstin: interstate ? '29AAAAA0000A1Z5' : null,
    bill,
    payments: [
      {
        id: 'pay1',
        method: 'cash',
        amountPaise: bill.totalPaise,
        tenderedPaise: bill.totalPaise,
        changePaise: null,
        reference: null,
      },
    ],
    changePaise: 0,
    notes: null,
    status: 'completed',
    voidedAt: null,
    voidReason: null,
    duplicate: false,
    loyalty: null,
    creditPaise: 0,
    priceLevel: 'retail',
  };
};

describe('receipt rendering', () => {
  for (const paperSize of ['58mm', '80mm', 'a4'] as const) {
    it(`renders a complete document for ${paperSize}`, () => {
      const html = buildReceiptHtml({ receipt: makeReceipt(), settings: settings(), paperSize });

      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toContain('</html>');
      expect(html).toContain('SGS-1001');
      expect(html).toContain('Sharma General Store');
      expect(html).toContain('Basmati Rice');
    });

    it(`shows the same total on ${paperSize} as the bill`, () => {
      const receipt = makeReceipt();
      const html = buildReceiptHtml({ receipt, settings: settings(), paperSize });
      // 2 x 499.00 + 1.5kg x 45.00 = 1065.50, rounded up to 1066.00 with a
      // 50 paise round-off line, because roundTotalToRupee is on.
      expect(receipt.bill.roundOffPaise).toBe(50);
      expect(receipt.bill.totalPaise).toBe(106600);
      expect(html).toContain('1,066.00');
      expect(html).toMatch(/Round off/i);
    });
  }

  it('escapes characters that would otherwise break the markup', () => {
    const receipt = makeReceipt();
    const html = buildReceiptHtml({ receipt, settings: settings(), paperSize: 'a4' });

    // The customer is "Ravi & Sons": the ampersand must be escaped.
    expect(html).toContain('Ravi &amp; Sons');
    expect(html).not.toMatch(/Ravi & Sons/);
  });

  it('cannot be broken by a product name containing a script tag', () => {
    const receipt = makeReceipt();
    const malicious = { ...receipt };
    malicious.bill = {
      ...receipt.bill,
      lines: [{ ...receipt.bill.lines[0]!, name: '<script>alert(1)</script>' }],
    };

    const html = buildReceiptHtml({ receipt: malicious, settings: settings(), paperSize: 'a4' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('calls it a tax invoice only when the shop has a GSTIN', () => {
    const withGst = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings({ gstin: '33AAAAA0000A1Z5' }),
      paperSize: 'a4',
    });
    expect(withGst).toMatch(/Tax Invoice/i);

    const withoutGst = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings({ gstin: '' }),
      paperSize: 'a4',
    });
    expect(withoutGst).not.toMatch(/Tax Invoice/i);
    expect(withoutGst).toMatch(/Receipt/i);
  });

  it('shows CGST and SGST locally, IGST across state lines', () => {
    const local = buildReceiptHtml({
      receipt: makeReceipt(false),
      settings: settings(),
      paperSize: 'a4',
    });
    expect(local).toContain('CGST');
    expect(local).toContain('SGST');
    expect(local).not.toContain('IGST');

    const across = buildReceiptHtml({
      receipt: makeReceipt(true),
      settings: settings(),
      paperSize: 'a4',
    });
    expect(across).toContain('IGST');
  });

  it('marks a reprint', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: '80mm',
      isReprint: true,
    });
    expect(html).toContain('REPRINT');
  });

  it('omits the logo when there is none', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: '80mm',
    });
    expect(html).not.toContain('<img');
  });

  it('inlines a logo when supplied', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: '80mm',
      logoDataUrl: 'data:image/png;base64,AAAA',
    });
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('sets the page width to the paper', () => {
    expect(
      buildReceiptHtml({ receipt: makeReceipt(), settings: settings(), paperSize: '58mm' }),
    ).toContain('58mm');
    expect(
      buildReceiptHtml({ receipt: makeReceipt(), settings: settings(), paperSize: '80mm' }),
    ).toContain('80mm');
    expect(
      buildReceiptHtml({ receipt: makeReceipt(), settings: settings(), paperSize: 'a4' }),
    ).toContain('A4');
  });

  it('orders the totals so a discount is not read as subtracted twice', () => {
    // The taxable value already has the discount removed. Showing gross first
    // makes the chain readable: gross, less discount, taxable, tax, total.
    const receipt = makeReceipt();
    const discounted: typeof receipt = {
      ...receipt,
      bill: { ...receipt.bill, itemDiscountPaise: 5000, grossPaise: receipt.bill.grossPaise },
    };

    // Exact labels, because a loose /discount/i also matches the items table's
    // "Disc" column header, which sits earlier in the document.
    const labels = {
      '80mm': ['>Gross<', '>Discount<', '>Taxable<'],
      a4: ['>Gross value<', '>Less discount<', '>Taxable value<'],
    } as const;

    for (const paperSize of ['80mm', 'a4'] as const) {
      const html = buildReceiptHtml({ receipt: discounted, settings: settings(), paperSize });
      const [gross, discount, taxable] = labels[paperSize];

      const grossAt = html.indexOf(gross);
      const discountAt = html.indexOf(discount);
      const taxableAt = html.indexOf(taxable);

      expect(grossAt, `${paperSize}: missing ${gross}`).toBeGreaterThan(-1);
      expect(grossAt).toBeLessThan(discountAt);
      expect(discountAt).toBeLessThan(taxableAt);
    }
  });

  it('omits the gross line when nothing was discounted', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: '80mm',
    });
    expect(html).not.toContain('>Gross<');
  });

  it('shows the HSN code on the A4 invoice', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: 'a4',
    });
    expect(html).toContain('1006');
    expect(html).toContain('HSN');
  });
});

describe('points on the receipt', () => {
  const withPoints = () => ({
    ...makeReceipt(),
    loyalty: { pointsEarned: 10, pointsRedeemed: 120, discountPaise: 12000, balancePoints: 10 },
  });

  const runningPoints = () => {
    const base = settings();
    return { ...base, loyalty: { ...base.loyalty, enabled: true, showOnReceipt: true } };
  };

  for (const paperSize of ['58mm', '80mm', 'a4'] as const) {
    it(`prints what the bill moved on ${paperSize}`, () => {
      const html = buildReceiptHtml({
        receipt: withPoints(),
        settings: runningPoints(),
        paperSize,
      });

      expect(html).toContain('120 points used');
      expect(html).toContain('10 points earned');
      expect(html).toContain('Balance 10');
    });
  }

  it('prints nothing when the shop does not run points', () => {
    const html = buildReceiptHtml({
      receipt: withPoints(),
      settings: settings(),
      paperSize: '80mm',
    });

    expect(html).not.toContain('points earned');
  });

  it('prints nothing when the shop runs points but keeps them off the receipt', () => {
    const base = runningPoints();
    const html = buildReceiptHtml({
      receipt: withPoints(),
      settings: { ...base, loyalty: { ...base.loyalty, showOnReceipt: false } },
      paperSize: '80mm',
    });

    expect(html).not.toContain('points earned');
  });
});

describe('voided invoices', () => {
  for (const paperSize of ['58mm', '80mm', 'a4'] as const) {
    it(`marks a voided sale on ${paperSize} so it cannot be claimed against`, () => {
      const receipt = makeReceipt();
      const html = buildReceiptHtml({
        receipt: {
          ...receipt,
          status: 'voided',
          voidedAt: '2026-10-12T11:00:00.000Z',
          voidReason: 'Customer cancelled',
        },
        settings: settings(),
        paperSize,
      });

      expect(html).toContain('VOIDED');
      expect(html).toContain('Customer cancelled');
    });
  }

  it('leaves a completed invoice unmarked', () => {
    const html = buildReceiptHtml({
      receipt: makeReceipt(),
      settings: settings(),
      paperSize: 'a4',
    });
    expect(html).not.toContain('VOIDED');
  });
});
