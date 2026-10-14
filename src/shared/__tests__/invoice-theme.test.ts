import { describe, expect, it } from 'vitest';
import { buildReceiptHtml } from '../receipt';
import { buildQuotationHtml } from '../quotation-document';
import { sampleReceipt } from '../sample-bill';
import { INVOICE_THEMES, defaultSettings, type AppSettings } from '../settings';
import type { Quotation } from '../quotations';

const shop = (overrides: Partial<AppSettings['template']> = {}): AppSettings => {
  const base = defaultSettings('Sharma General Store');
  return {
    ...base,
    shop: { ...base.shop, stateCode: '33', address: '14 Mount Road', gstin: '33AAAAA0000A1Z5' },
    tax: { ...base.tax, registered: true },
    template: { ...base.template, ...overrides },
  };
};

const a4 = (settings: AppSettings): string =>
  buildReceiptHtml({ receipt: sampleReceipt(), settings, paperSize: 'a4' });

describe('every theme', () => {
  for (const theme of INVOICE_THEMES) {
    it(`${theme} prints a complete tax invoice`, () => {
      const html = a4(shop({ theme }));

      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toContain('Tax Invoice');
      expect(html).toContain('Sharma General Store');
      expect(html).toContain('33AAAAA0000A1Z5');
      // The figures are the document, not the dress: every theme shows the
      // lines, the tax summary and the same total.
      expect(html).toContain('Basmati Rice');
      expect(html).toContain('CGST');
      expect(html).toContain('SGST');
      // 2 x 499 less a 20 discount, 3 x 145 and 1 kg at 110: 1,523.00.
      expect(html).toContain('1,523.00');
    });

    it(`${theme} takes the shop's colour`, () => {
      expect(a4(shop({ theme, accent: '#B42318' }))).toContain('#B42318');
    });
  }
});

describe('what a shop can turn off', () => {
  it('drops the HSN column without disturbing the tax columns', () => {
    const withHsn = a4(shop({ showHsn: true }));
    const without = a4(shop({ showHsn: false }));

    expect(withHsn).toContain('<th>HSN</th>');
    expect(withHsn).toContain('1006');
    expect(without).not.toContain('<th>HSN</th>');
    expect(without).not.toContain('1006');
    // Still a tax invoice: the GST columns and summary stay.
    expect(without).toContain('<th class="num">GST</th>');
    expect(without).toContain('CGST');
  });

  it('drops the discount column', () => {
    expect(a4(shop({ showDiscount: false }))).not.toContain('<th class="num">Disc</th>');
    expect(a4(shop({ showDiscount: true }))).toContain('<th class="num">Disc</th>');
  });

  it('drops the logo when the shop would rather not print it', () => {
    const logoDataUrl = 'data:image/png;base64,LOGO';
    const settings = shop({ showLogo: false });
    const html = buildReceiptHtml({
      receipt: sampleReceipt(),
      settings,
      paperSize: 'a4',
      logoDataUrl,
    });
    expect(html).not.toContain('LOGO');
  });

  it('drops the signature line', () => {
    expect(a4(shop({ showSignature: false }))).not.toContain('class="sign"');
    expect(a4(shop({ showSignature: true }))).toContain('class="sign"');
  });
});

describe('what a shop can add', () => {
  it('prints terms and payment details at the foot', () => {
    const html = a4(
      shop({
        terms: 'Goods once sold are not returnable.',
        bankDetails: 'Bank of India · A/c 001234567890',
      }),
    );
    expect(html).toContain('Goods once sold are not returnable.');
    expect(html).toContain('Bank of India');
  });

  it('escapes what the shop typed', () => {
    const html = a4(shop({ terms: 'Returns <within> 7 days & receipt' }));
    expect(html).toContain('Returns &lt;within&gt; 7 days &amp; receipt');
  });

  it('signs in the shop\'s own words when it gives them', () => {
    const html = a4(shop({ signatureLabel: 'Sharma & Sons (Prop.)' }));
    expect(html).toContain('For Sharma &amp; Sons (Prop.)');
  });
});

describe('a quotation', () => {
  const quotation = (): Quotation => {
    const receipt = sampleReceipt();
    return {
      id: 'q1',
      quotationNumber: 'SGS-QTN-0001',
      quotationDate: '2026-10-14T09:30:00.000Z',
      validUntil: null,
      customerId: null,
      customerName: null,
      customerGstin: null,
      bill: receipt.bill,
      notes: null,
      terms: null,
      status: 'open',
      convertedSaleId: null,
      convertedInvoiceNumber: null,
      cancelReason: null,
      priceLevel: 'retail',
      items: receipt.bill.lines.length,
      totalPaise: receipt.bill.totalPaise,
    };
  };

  it('is dressed like the invoice it may become', () => {
    const settings = shop({ theme: 'bordered', accent: '#0A7C55' });
    const html = buildQuotationHtml({ quotation: quotation(), settings });
    expect(html).toContain('#0A7C55');
    expect(html).toContain('3px double');
  });
});
