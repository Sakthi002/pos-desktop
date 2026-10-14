import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COUNTRY_CODE,
  purchaseOrderMessage,
  quotationMessage,
  saleMessage,
  statementMessage,
  toWhatsappNumber,
  whatsappLink,
} from '../whatsapp';
import { buildStatementHtml } from '../statement-document';
import { defaultSettings, type AppSettings } from '../settings';
import type { CustomerAccount, CustomerReceipt } from '../trade';

describe('a number as a shop types it', () => {
  it('takes ten digits as Indian', () => {
    expect(toWhatsappNumber('9876543210').number).toBe('919876543210');
  });

  it('ignores the spaces, dashes and plus a shop writes', () => {
    expect(toWhatsappNumber('+91 98765-43210').number).toBe('919876543210');
    expect(toWhatsappNumber('098765 43210').number).toBe('919876543210');
  });

  it('keeps a number that already carries a country code', () => {
    expect(toWhatsappNumber('971501234567').number).toBe('971501234567');
  });

  it('takes another country code when the shop is not in India', () => {
    expect(toWhatsappNumber('5551234567', '1').number).toBe('15551234567');
    expect(DEFAULT_COUNTRY_CODE).toBe('91');
  });

  it('refuses what it cannot make sense of rather than guessing', () => {
    // A bill sent to the wrong person cannot be recalled, so a short number
    // is a problem to show, not a number to pad out.
    const short = toWhatsappNumber('98765');
    expect(short.number).toBeNull();
    expect(short.problem).toContain('98765');

    expect(toWhatsappNumber(null).number).toBeNull();
    expect(toWhatsappNumber('').problem).toBe('No phone number on file.');
    expect(toWhatsappNumber('abc').number).toBeNull();
  });
});

describe('the link', () => {
  it('carries the message in the URL and nothing else', () => {
    const link = whatsappLink({ number: '919876543210', message: 'Hello, ₹100 due' });
    expect(link.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(link).toContain(encodeURIComponent('Hello, ₹100 due'));
    // Newlines and rupee signs must survive being put in a URL.
    expect(decodeURIComponent(link.split('?text=')[1] ?? '')).toBe('Hello, ₹100 due');
  });
});

describe('the messages', () => {
  const base = { shopName: 'Sharma General Store', toName: 'Meena Traders' };

  it('names the document, the shop and the amount', () => {
    const text = saleMessage({ ...base, documentNumber: 'SGS-1023', amountPaise: 152300 });
    expect(text).toContain('Hello Meena Traders,');
    expect(text).toContain('SGS-1023');
    expect(text).toContain('Sharma General Store');
    expect(text).toContain('1,523.00');
  });

  it('asks for payment only when a UPI id is given', () => {
    expect(saleMessage({ ...base, documentNumber: 'SGS-1023', amountPaise: 100 })).not.toContain(
      'UPI',
    );
    expect(
      saleMessage({ ...base, documentNumber: 'SGS-1023', amountPaise: 100, upiId: 'shop@okaxis' }),
    ).toContain('shop@okaxis');
  });

  it('greets a customer with no name on file without an empty space', () => {
    expect(saleMessage({ shopName: 'X', documentNumber: 'A', amountPaise: 0 })).toContain(
      'Hello,',
    );
    expect(saleMessage({ shopName: 'X', toName: '  ', documentNumber: 'A', amountPaise: 0 })).toContain(
      'Hello,',
    );
  });

  it('says how long a quotation holds', () => {
    const text = quotationMessage({
      ...base,
      documentNumber: 'SGS-QTN-0003',
      amountPaise: 500000,
      byDate: '2026-11-30T00:00:00.000Z',
    });
    expect(text).toContain('30/11/2026');
    expect(
      quotationMessage({ ...base, documentNumber: 'Q', amountPaise: 0, byDate: null }),
    ).toContain('until withdrawn');
  });

  it('asks a supplier for a date when the order has one', () => {
    const text = purchaseOrderMessage({
      ...base,
      documentNumber: 'SGS-PO-0001',
      amountPaise: 2500000,
      byDate: '2026-10-20T00:00:00.000Z',
    });
    expect(text).toContain('SGS-PO-0001');
    expect(text).toContain('20/10/2026');
  });

  it('counts the bills on a statement in the singular and the plural', () => {
    expect(statementMessage({ ...base, amountPaise: 100, bills: 1 })).toContain('1 bill.');
    expect(statementMessage({ ...base, amountPaise: 100, bills: 3 })).toContain('3 bills.');
  });

  it('ignores a date it cannot read rather than printing NaN', () => {
    expect(
      quotationMessage({ ...base, documentNumber: 'Q', amountPaise: 0, byDate: 'not a date' }),
    ).toContain('until withdrawn');
  });
});

// ─── The statement itself ───────────────────────────────────────────────────

const settings = (upiId?: string): AppSettings => {
  const base = defaultSettings('Sharma General Store');
  return {
    ...base,
    shop: { ...base.shop, stateCode: '33', address: '14 Mount Road', phone: '044 1234 5678' },
    ...(upiId ? { template: { ...base.template, upiId } } : {}),
  };
};

const account: CustomerAccount = {
  customerId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Meena Traders',
  creditLimitPaise: 1000000,
  outstandingPaise: 450000,
  availablePaise: 550000,
  bills: [
    {
      saleId: '22222222-2222-4222-8222-222222222222',
      invoiceNumber: 'SGS-1019',
      invoiceDate: '2026-10-02T06:00:00.000Z',
      totalPaise: 500000,
      creditPaise: 500000,
      outstandingPaise: 450000,
    },
  ],
};

const receipts: CustomerReceipt[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    customerId: account.customerId,
    saleId: account.bills[0]?.saleId ?? null,
    invoiceNumber: 'SGS-1019',
    receiptDate: '2026-10-09T06:00:00.000Z',
    method: 'upi',
    amountPaise: 50000,
    reference: 'UTR9912',
    notes: null,
  },
];

describe('a statement of account', () => {
  it('shows the bills still open and the money already received', () => {
    const html = buildStatementHtml({
      account,
      receipts,
      settings: settings(),
      asOfIso: '2026-10-14T06:00:00.000Z',
    });

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('Statement of account');
    expect(html).toContain('Meena Traders');
    expect(html).toContain('SGS-1019');
    expect(html).toContain('14/10/2026');
    expect(html).toContain('UTR9912');
    expect(html).toContain('4,500.00');
    // It must never read as a demand for a new amount.
    expect(html).toContain('not a bill');
    expect(html).not.toContain('Tax Invoice');
  });

  it('carries a pay code only when there is a UPI id and something owed', () => {
    const withCode = buildStatementHtml({ account, receipts, settings: settings('shop@okaxis') });
    expect(withCode).toContain('Scan to pay');
    expect(withCode).toContain('<svg');

    expect(buildStatementHtml({ account, receipts, settings: settings() })).not.toContain(
      'Scan to pay',
    );

    const settled = { ...account, outstandingPaise: 0, bills: [] };
    expect(
      buildStatementHtml({ account: settled, receipts, settings: settings('shop@okaxis') }),
    ).not.toContain('Scan to pay');
  });

  it('says so plainly when nothing is outstanding', () => {
    const html = buildStatementHtml({
      account: { ...account, outstandingPaise: 0, bills: [] },
      receipts: [],
      settings: settings(),
    });
    expect(html).toContain('Nothing is outstanding');
  });

  it('escapes a name that contains markup', () => {
    const html = buildStatementHtml({
      account: { ...account, customerName: '<script>x</script>' },
      receipts: [],
      settings: settings(),
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
