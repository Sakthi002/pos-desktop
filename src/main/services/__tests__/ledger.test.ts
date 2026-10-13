import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { SaleService } from '../sale-service';
import { ReturnService } from '../return-service';
import { SupplierService } from '../supplier-service';
import { PurchaseService } from '../purchase-service';
import { LedgerService, LedgerError } from '../ledger-service';
import { ACCOUNTS } from '@shared/ledger';
import { defaultSettings } from '@shared/settings';

let db: Database;
let catalogue: CatalogueService;
let sales: SaleService;
let returns: ReturnService;
let suppliers: SupplierService;
let purchases: PurchaseService;
let ledger: LedgerService;
let riceId: string;
let supplierId: string;

const EVERYTHING = {
  fromIso: '2000-01-01T00:00:00.000Z',
  toIso: '2100-01-01T00:00:00.000Z',
};

/** The whole point of double entry: this must be zero, always. */
const outOfBalance = (): number => {
  const rows = ledger.trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
  const debit = rows.reduce((a, r) => a + r.debitPaise, 0);
  const credit = rows.reduce((a, r) => a + r.creditPaise, 0);
  return debit - credit;
};

const balanceOf = (code: string): number =>
  ledger.trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso).find((r) => r.code === code)
    ?.balancePaise ?? 0;

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 50000,
  }).id;

  sales = new SaleService(db);
  returns = new ReturnService(db);
  suppliers = new SupplierService(db);
  purchases = new PurchaseService(db);
  ledger = new LedgerService(db);

  supplierId = suppliers.create({
    name: 'Chennai Wholesale',
    stateCode: '33',
    creditLimitPaise: 0,
  }).id;
});

afterEach(() => {
  db.close();
});

const sell = (payments: { method: string; amountPaise: number; tenderedPaise?: number }[]) =>
  sales.createSale({
    idempotencyKey: randomUUID(),
    lines: [{ productId: riceId, quantityMilli: 2000, unitPricePaise: 10000, discountPaise: 0 }],
    cartDiscountPaise: 0,
    payments,
  });

const buy = (payment?: { method: string; amountPaise: number }) =>
  purchases.createPurchase({
    idempotencyKey: randomUUID(),
    supplierId,
    supplierBillNo: 'CW/1',
    taxMode: 'exclusive',
    lines: [{ productId: riceId, quantityMilli: 10000, unitCostPaise: 7000 }],
    billDiscountPaise: 0,
    payment: payment ?? null,
  });

describe('the chart of accounts', () => {
  it('is seeded the first time the books are opened', () => {
    const accounts = ledger.accounts();
    expect(accounts.length).toBeGreaterThanOrEqual(18);
    expect(accounts.find((a) => a.code === ACCOUNTS.cash)?.name).toBe('Cash in hand');
    expect(accounts.find((a) => a.code === ACCOUNTS.sales)?.group).toBe('income');
    expect(accounts.every((a) => a.isSystem)).toBe(true);
  });

  it('is not seeded twice', () => {
    const before = ledger.accounts().length;
    ledger.ensureChart();
    expect(ledger.accounts()).toHaveLength(before);
  });
});

describe('a sale', () => {
  it('debits the money taken and credits sales and GST', () => {
    const sale = sell([{ method: 'cash', amountPaise: 20000 }]);

    expect(balanceOf(ACCOUNTS.cash)).toBe(20000);
    expect(balanceOf(ACCOUNTS.sales)).toBe(sale.bill.taxablePaise);
    expect(balanceOf(ACCOUNTS.gstOutput)).toBe(sale.bill.taxPaise);
    expect(outOfBalance()).toBe(0);
  });

  it('splits across the accounts the money actually landed in', () => {
    sell([
      { method: 'cash', amountPaise: 5000 },
      { method: 'upi', amountPaise: 15000 },
    ]);

    expect(balanceOf(ACCOUNTS.cash)).toBe(5000);
    expect(balanceOf(ACCOUNTS.upi)).toBe(15000);
    expect(outOfBalance()).toBe(0);
  });

  it('counts only what stayed in the till, not the note handed over', () => {
    sell([{ method: 'cash', amountPaise: 50000, tenderedPaise: 50000 }]);

    // ₹500 offered for a ₹200 bill: ₹300 went straight back as change.
    expect(balanceOf(ACCOUNTS.cash)).toBe(20000);
    expect(outOfBalance()).toBe(0);
  });

  it('is reversed exactly when the sale is voided', () => {
    const sale = sell([{ method: 'cash', amountPaise: 20000 }]);
    sales.voidSale({ id: sale.id, reason: 'Keyed twice' });

    expect(balanceOf(ACCOUNTS.cash)).toBe(0);
    expect(balanceOf(ACCOUNTS.sales)).toBe(0);
    expect(balanceOf(ACCOUNTS.gstOutput)).toBe(0);
    expect(outOfBalance()).toBe(0);
  });
});

describe('a credit note', () => {
  it('debits sales returns and pays the customer back', () => {
    const sale = sell([{ method: 'cash', amountPaise: 20000 }]);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;

    const credit = returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Wrong item',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 1000, restock: true }],
    });

    expect(balanceOf(ACCOUNTS.cash)).toBe(20000 - credit.totalPaise);
    expect(balanceOf(ACCOUNTS.salesReturn)).toBe(credit.taxablePaise);
    expect(outOfBalance()).toBe(0);
  });
});

describe('a purchase', () => {
  it('is an expense and a liability, with the tax reclaimable', () => {
    const purchase = buy();

    expect(balanceOf(ACCOUNTS.purchases)).toBe(purchase.taxablePaise);
    expect(balanceOf(ACCOUNTS.gstInput)).toBe(purchase.taxPaise);
    expect(balanceOf(ACCOUNTS.payable)).toBe(purchase.totalPaise);
    expect(outOfBalance()).toBe(0);
  });

  it('settles the liability when it is paid', () => {
    const purchase = buy({ method: 'bank', amountPaise: 73500 });

    expect(balanceOf(ACCOUNTS.payable)).toBe(0);
    expect(balanceOf(ACCOUNTS.bank)).toBe(-73500);
    expect(purchase.outstandingPaise).toBe(0);
    expect(outOfBalance()).toBe(0);
  });

  it('is reversed when the bill is cancelled', () => {
    const purchase = buy();
    purchases.cancelPurchase({ id: purchase.id, reason: 'Entered twice' });

    expect(balanceOf(ACCOUNTS.purchases)).toBe(0);
    expect(balanceOf(ACCOUNTS.payable)).toBe(0);
    expect(balanceOf(ACCOUNTS.gstInput)).toBe(0);
    expect(outOfBalance()).toBe(0);
  });

  it('reduces what we owe when goods go back on a debit note', () => {
    const purchase = buy();
    const credit = purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Damaged',
      settlement: 'debit_note',
      lines: [{ purchaseItemId: purchase.lines[0]!.id, quantityMilli: 2000 }],
    });

    expect(balanceOf(ACCOUNTS.payable)).toBe(purchase.totalPaise - credit.totalPaise);
    expect(balanceOf(ACCOUNTS.purchaseReturn)).toBe(credit.taxablePaise);
    expect(outOfBalance()).toBe(0);
  });

  it('brings cash back when the supplier refunds instead', () => {
    const purchase = buy({ method: 'cash', amountPaise: 73500 });
    purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Short supplied',
      settlement: 'cash',
      lines: [{ purchaseItemId: purchase.lines[0]!.id, quantityMilli: 2000 }],
    });

    // Paid 73,500 then 14,700 came back.
    expect(balanceOf(ACCOUNTS.cash)).toBe(-73500 + 14700);
    expect(balanceOf(ACCOUNTS.payable)).toBe(0);
    expect(outOfBalance()).toBe(0);
  });
});

describe('a day of trading', () => {
  it('leaves the books balanced across every kind of document', () => {
    const sale = sell([
      { method: 'cash', amountPaise: 10000 },
      { method: 'card', amountPaise: 10000 },
    ]);
    const saleItemId = (
      db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(sale.id) as { id: string }
    ).id;
    returns.createReturn({
      idempotencyKey: randomUUID(),
      saleId: sale.id,
      reason: 'Damaged',
      refundMethod: 'cash',
      lines: [{ saleItemId, quantityMilli: 1000, restock: false }],
    });

    const voided = sell([{ method: 'upi', amountPaise: 20000 }]);
    sales.voidSale({ id: voided.id, reason: 'Keyed twice' });

    const purchase = buy();
    purchases.createReturn({
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      reason: 'Torn',
      lines: [{ purchaseItemId: purchase.lines[0]!.id, quantityMilli: 1000 }],
    });
    purchases.recordPayment({
      supplierId,
      purchaseId: purchase.id,
      method: 'bank',
      amountPaise: 30000,
    });

    expect(outOfBalance()).toBe(0);

    // And the trial balance is not trivially empty.
    const rows = ledger.trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
    expect(rows.filter((r) => r.debitPaise + r.creditPaise > 0).length).toBeGreaterThan(5);
  });
});

describe('what the books refuse', () => {
  it('an unbalanced voucher', () => {
    expect(() =>
      ledger.post({
        type: 'journal',
        date: new Date().toISOString(),
        narration: 'Wishful thinking',
        lines: [
          { accountCode: ACCOUNTS.cash, debitPaise: 1000 },
          { accountCode: ACCOUNTS.sales, creditPaise: 900 },
        ],
      }),
    ).toThrow(LedgerError);
  });

  it('a voucher with no amount at all', () => {
    expect(() =>
      ledger.post({
        type: 'journal',
        date: new Date().toISOString(),
        narration: 'Nothing',
        lines: [{ accountCode: ACCOUNTS.cash, debitPaise: 0 }],
      }),
    ).toThrow(LedgerError);
  });

  it('any change to a voucher or an entry once written', () => {
    sell([{ method: 'cash', amountPaise: 20000 }]);
    const voucherId = (db.prepare('SELECT id FROM vouchers LIMIT 1').get() as { id: string }).id;

    expect(() =>
      db.prepare('UPDATE vouchers SET narration = ? WHERE id = ?').run('x', voucherId),
    ).toThrow(/cannot be changed/);
    expect(() => db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucherId)).toThrow(
      /cannot be deleted/,
    );
    expect(() => db.prepare('UPDATE ledger_entries SET debit_paise = 1').run()).toThrow(
      /cannot be changed/,
    );
    expect(() => db.prepare('DELETE FROM ledger_entries').run()).toThrow(/cannot be deleted/);
  });

  it('a second set of opening balances', () => {
    const asOfIso = new Date().toISOString();
    ledger.postOpeningBalances({ cashPaise: 500000, asOfIso });

    expect(() => ledger.postOpeningBalances({ cashPaise: 100, asOfIso })).toThrow(/already/);
  });
});

describe('opening balances', () => {
  it('put what the shop already held on the books', () => {
    ledger.postOpeningBalances({
      cashPaise: 500000,
      bankPaise: 2500000,
      payablePaise: 400000,
      asOfIso: new Date().toISOString(),
    });

    expect(balanceOf(ACCOUNTS.cash)).toBe(500000);
    expect(balanceOf(ACCOUNTS.bank)).toBe(2500000);
    expect(balanceOf(ACCOUNTS.payable)).toBe(400000);
    expect(balanceOf(ACCOUNTS.openingBalance)).toBe(2600000);
    expect(outOfBalance()).toBe(0);
  });
});

describe("the shop's own entries", () => {
  it("adds an account in its group's block and posts an expense to it", () => {
    sell([{ method: 'cash', amountPaise: 20000 }]);

    const rent = ledger.createAccount({ name: 'Shop rent', group: 'expense' });
    expect(rent.code).toBe('5600');
    expect(rent.normalBalance).toBe('debit');
    expect(rent.isSystem).toBe(false);

    ledger.postJournal({
      dateIso: new Date().toISOString(),
      narration: 'October rent',
      lines: [
        { accountCode: rent.code, debitPaise: 1500000, creditPaise: 0 },
        { accountCode: ACCOUNTS.cash, debitPaise: 0, creditPaise: 1500000 },
      ],
    });

    expect(balanceOf(rent.code)).toBe(1500000);
    expect(balanceOf(ACCOUNTS.cash)).toBe(20000 - 1500000);
    expect(outOfBalance()).toBe(0);
  });

  it('gives each new account the next free code', () => {
    const first = ledger.createAccount({ name: 'Wages', group: 'expense' });
    const second = ledger.createAccount({ name: 'Electricity', group: 'expense' });
    const asset = ledger.createAccount({ name: 'Second bank', group: 'asset' });

    expect([first.code, second.code, asset.code]).toEqual(['5600', '5601', '1600']);
    expect(asset.normalBalance).toBe('debit');
  });

  it('refuses a journal that does not balance', () => {
    expect(() =>
      ledger.postJournal({
        dateIso: new Date().toISOString(),
        narration: 'Wrong',
        lines: [
          { accountCode: ACCOUNTS.cash, debitPaise: 100, creditPaise: 0 },
          { accountCode: ACCOUNTS.capital, debitPaise: 0, creditPaise: 90 },
        ],
      }),
    ).toThrow(LedgerError);

    expect(outOfBalance()).toBe(0);
  });

  it('refuses a line that is both a debit and a credit', () => {
    expect(() =>
      ledger.postJournal({
        dateIso: new Date().toISOString(),
        narration: 'Both sides',
        lines: [
          { accountCode: ACCOUNTS.cash, debitPaise: 100, creditPaise: 100 },
          { accountCode: ACCOUNTS.capital, debitPaise: 100, creditPaise: 100 },
        ],
      }),
    ).toThrow(LedgerError);
  });
});

describe('catching up', () => {
  it('posts a document that was written before the books existed', () => {
    // A sale inserted the way an older version would have, with no voucher.
    const sale = sell([{ method: 'cash', amountPaise: 20000 }]);
    const raw = randomUUID();
    const company = (db.prepare('SELECT id FROM companies LIMIT 1').get() as { id: string }).id;
    const branch = (db.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }).id;
    const t = new Date().toISOString();

    db.prepare(
      `INSERT INTO sales (id, company_id, branch_id, invoice_number, financial_year, invoice_date,
         tax_mode, gross_paise, taxable_paise, tax_paise, cgst_paise, sgst_paise, total_paise,
         status, created_at, updated_at)
       VALUES (?, ?, ?, 'INV-9000', '2026-27', ?, 'inclusive', 50000, 47619, 2381, 1191, 1190,
         50000, 'completed', ?, ?)`,
    ).run(raw, company, branch, t, t, t);
    db.prepare(
      `INSERT INTO payments (id, sale_id, method, amount_paise, created_at)
       VALUES (?, ?, 'cash', 50000, ?)`,
    ).run(randomUUID(), raw, t);

    expect(ledger.postMissing()).toBe(1);
    expect(balanceOf(ACCOUNTS.cash)).toBe(20000 + 50000);
    expect(outOfBalance()).toBe(0);

    // Running it again changes nothing.
    expect(ledger.postMissing()).toBe(0);
    expect(balanceOf(ACCOUNTS.cash)).toBe(20000 + 50000);
    void sale;
  });
});

describe('reading the books', () => {
  it('gives an account statement with a running balance', () => {
    sell([{ method: 'cash', amountPaise: 20000 }]);
    sell([{ method: 'cash', amountPaise: 20000 }]);

    const statement = ledger.statement({ accountCode: ACCOUNTS.cash, ...EVERYTHING });

    expect(statement.account.name).toBe('Cash in hand');
    expect(statement.openingPaise).toBe(0);
    expect(statement.lines).toHaveLength(2);
    expect(statement.lines[0]?.balancePaise).toBe(20000);
    expect(statement.lines[1]?.balancePaise).toBe(40000);
    expect(statement.closingPaise).toBe(40000);
  });

  it("gives a supplier's own account out of the payables control", () => {
    const purchase = buy();
    purchases.recordPayment({
      supplierId,
      purchaseId: purchase.id,
      method: 'bank',
      amountPaise: 30000,
    });

    const statement = ledger.partyStatement({
      partyType: 'supplier',
      partyId: supplierId,
      ...EVERYTHING,
    });

    expect(statement.partyName).toBe('Chennai Wholesale');
    expect(statement.account.code).toBe(ACCOUNTS.payable);
    expect(statement.openingPaise).toBe(0);
    // The bill put it on the account, the payment took part of it off.
    expect(statement.lines).toHaveLength(2);
    expect(statement.closingPaise).toBe(purchase.totalPaise - 30000);
  });

  it('refuses a statement for a party that does not exist', () => {
    expect(() =>
      ledger.partyStatement({ partyType: 'supplier', partyId: randomUUID(), ...EVERYTHING }),
    ).toThrow(LedgerError);
  });

  it('lists every voucher in the day book', () => {
    sell([{ method: 'cash', amountPaise: 20000 }]);
    buy();

    const entries = ledger.dayBook(EVERYTHING.fromIso, EVERYTHING.toIso);
    expect(entries.map((e) => e.voucher_type)).toContain('sale');
    expect(entries.map((e) => e.voucher_type)).toContain('purchase');
    expect(entries[0]?.voucher_no).toMatch(/^V-\d{4}$/);
  });
});
