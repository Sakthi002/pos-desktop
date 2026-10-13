import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { SettingsService } from '../settings-service';
import { CatalogueService } from '../catalogue-service';
import { SupplierService } from '../supplier-service';
import { PurchaseService } from '../purchase-service';
import { SaleService } from '../sale-service';
import { LedgerService } from '../ledger-service';
import { defaultSettings } from '@shared/settings';
import { buildReceiptHtml } from '@shared/receipt';
import { ACCOUNTS } from '@shared/ledger';

/**
 * A shop below the registration threshold. It charges no GST, prints none, and
 * cannot reclaim the tax on what it buys — so that tax is part of what the
 * goods cost, not an asset.
 */
let db: Database;
let catalogue: CatalogueService;
let riceId: string;

const EVERYTHING = { fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' };

const balanceOf = (code: string): number =>
  new LedgerService(db)
    .trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso)
    .find((r) => r.code === code)?.balancePaise ?? 0;

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Corner Shop');
  // No GSTIN: a shop that has not registered.
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  catalogue = new CatalogueService(db);
  riceId = catalogue.create({
    name: 'Basmati Rice 5kg',
    sku: 'RICE5',
    unitCode: 'pc',
    pricePaise: 10000,
    costPaise: 7000,
    // The product still carries a rate; the shop simply does not charge it.
    taxRateBp: 500,
    taxInclusive: true,
    trackInventory: true,
    reorderLevelMilli: 0,
    isActive: true,
    openingStockMilli: 100000,
  }).id;
});

afterEach(() => {
  db.close();
});

describe('a shop that is not registered', () => {
  it('is set that way by setup, because it gave no GSTIN', () => {
    expect(new SettingsService(db).get()?.tax.registered).toBe(false);
  });

  it('charges nothing on a bill, whatever the product says', () => {
    const sale = new SaleService(db).createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    expect(sale.bill.taxPaise).toBe(0);
    expect(sale.bill.taxablePaise).toBe(10000);
    expect(sale.bill.totalPaise).toBe(10000);
    expect(sale.bill.taxBreakdown.every((b) => b.taxPaise === 0)).toBe(true);
  });

  it('owes no GST on what it sold', () => {
    new SaleService(db).createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    expect(balanceOf(ACCOUNTS.gstOutput)).toBe(0);
    expect(balanceOf(ACCOUNTS.sales)).toBe(10000);
  });

  it('prints a receipt, not a tax invoice', () => {
    const sale = new SaleService(db).createSale({
      idempotencyKey: randomUUID(),
      lines: [{ productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 }],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    const settings = new SettingsService(db).require();
    for (const paperSize of ['80mm', 'a4'] as const) {
      const html = buildReceiptHtml({ receipt: sale, settings, paperSize });
      expect(html).not.toMatch(/TAX INVOICE|Tax Invoice/);
      expect(html).not.toMatch(/CGST|SGST|IGST/);
      // No empty tax columns on the line table either.
      expect(html).not.toMatch(/>HSN</);
      expect(html).not.toMatch(/>GST</);
      expect(html).not.toMatch(/>Taxable</);
      expect(html).not.toMatch(/GSTIN/);
    }
  });

  describe('buying stock', () => {
    const buy = () => {
      const supplierId = new SupplierService(db).create({
        name: 'Chennai Wholesale',
        stateCode: '33',
        creditLimitPaise: 0,
      }).id;

      return new PurchaseService(db).createPurchase({
        idempotencyKey: randomUUID(),
        supplierId,
        supplierBillNo: 'CW/1',
        taxMode: 'exclusive',
        lines: [{ productId: riceId, quantityMilli: 1000, unitCostPaise: 10000 }],
        billDiscountPaise: 0,
        payment: null,
      });
    };

    it('still pays the supplier what the bill says', () => {
      const purchase = buy();

      expect(purchase.taxablePaise).toBe(10000);
      expect(purchase.taxPaise).toBe(500);
      expect(purchase.totalPaise).toBe(10500);
    });

    it('treats the tax it cannot reclaim as part of the cost', () => {
      buy();

      // ₹105 for one unit, not ₹100: the 5% is money gone, not an asset.
      expect(catalogue.get(riceId)?.costPaise).toBe(10500);
      expect(balanceOf(ACCOUNTS.gstInput)).toBe(0);
      expect(balanceOf(ACCOUNTS.purchases)).toBe(10500);
    });

    it('keeps the books in balance either way', () => {
      buy();
      const rows = new LedgerService(db).trialBalance(EVERYTHING.fromIso, EVERYTHING.toIso);
      expect(rows.reduce((a, r) => a + r.debitPaise - r.creditPaise, 0)).toBe(0);
    });
  });

  describe('and the day it registers', () => {
    it('charges tax again from the products it already had', () => {
      new SettingsService(db).update({ tax: { registered: true } });

      const sale = new SaleService(db).createSale({
        idempotencyKey: randomUUID(),
        lines: [
          { productId: riceId, quantityMilli: 1000, unitPricePaise: 10000, discountPaise: 0 },
        ],
        cartDiscountPaise: 0,
        payments: [{ method: 'cash', amountPaise: 10000 }],
      });

      // The rate was on the product all along.
      expect(sale.bill.taxPaise).toBe(476);
      expect(balanceOf(ACCOUNTS.gstOutput)).toBe(476);
    });
  });
});
