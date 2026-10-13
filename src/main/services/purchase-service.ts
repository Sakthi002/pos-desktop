/**
 * Buying.
 *
 * A supplier's bill is a bill with the arrow reversed, so it runs through the
 * same calculation engine the till uses: one place decides how tax, discounts
 * and rounding behave, whichever direction the goods move.
 *
 * Three rules shape the rest:
 *
 *   1. Stock arrives only as a movement, with the cost it arrived at.
 *   2. A product's cost price follows the latest purchase, excluding the tax a
 *      registered dealer reclaims — otherwise every margin is understated.
 *   3. A purchase is cancelled, never deleted, and cancelling reverses exactly
 *      the stock it brought in.
 */
import type { Database } from 'better-sqlite3';
import { calculateBill, type BillLineInput } from '@shared/billing';
import { financialYearOf, type AppSettings } from '@shared/settings';
import { formatQuantity, precisionFor } from '@shared/quantity';
import {
  cancelPurchaseSchema,
  purchaseInputSchema,
  purchaseQuerySchema,
  purchaseReturnInputSchema,
  supplierPaymentSchema,
  type PurchaseInput,
  type PurchasePage,
  type PurchaseQuery,
  type PurchaseReceipt,
  type PurchaseReturnInput,
  type PurchaseReturnReceipt,
} from '@shared/purchasing';
import { newId, now, inTransaction } from '../db/repositories/base';
import { PurchasingRepository } from '../db/repositories/purchasing';
import { CatalogueRepository } from '../db/repositories/catalogue';
import { AuditRepository } from '../db/repositories/audit';
import { SettingsService } from './settings-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class PurchaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseError';
  }
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit_code: string;
  tax_rate_bp: number;
  track_inventory: number;
  is_active: number;
}

export class PurchaseService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: PurchasingRepository;
  private readonly catalogue: CatalogueRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new PurchaseError('SETUP_INCOMPLETE', 'Complete setup before buying stock.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) {
      throw new PurchaseError('SETUP_INCOMPLETE', 'Complete setup before buying stock.');
    }
    this.settings = settings;

    this.repo = new PurchasingRepository(db, ctx.companyId);
    this.catalogue = new CatalogueRepository(db, ctx.companyId);
    this.audit = new AuditRepository(db);
  }

  private loadProducts(ids: string[]): Map<string, ProductRow> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, sku, hsn, unit_code, tax_rate_bp, track_inventory, is_active
           FROM products WHERE company_id = ? AND id IN (${placeholders})`,
      )
      .all(this.ctx.companyId, ...ids) as ProductRow[];
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The supplier's state decides CGST+SGST against IGST, exactly as a sale does. */
  private isInterstate(supplierState: string | null): boolean {
    if (!supplierState || !this.ctx.branchStateCode) return false;
    return supplierState !== this.ctx.branchStateCode;
  }

  createPurchase(input: unknown): PurchaseReceipt {
    const parsed: PurchaseInput = purchaseInputSchema.parse(input);

    const already = this.repo.findByIdempotencyKey(parsed.idempotencyKey);
    if (already) {
      const existing = this.repo.findPurchase(already);
      if (existing) return { ...existing, duplicate: true };
    }

    const supplier = this.repo.findSupplier(parsed.supplierId);
    if (!supplier) throw new PurchaseError('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    if (!supplier.isActive) {
      throw new PurchaseError('SUPPLIER_INACTIVE', `${supplier.name} is no longer active.`);
    }

    const products = this.loadProducts(parsed.lines.map((l) => l.productId));
    const inclusive = parsed.taxMode === 'inclusive';

    const lines: BillLineInput[] = parsed.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product) {
        throw new PurchaseError('PRODUCT_NOT_FOUND', 'A product on this bill no longer exists.');
      }
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: null,
        hsn: product.hsn,
        unitCode: product.unit_code,
        quantityMilli: line.quantityMilli,
        unitPricePaise: line.unitCostPaise,
        taxRateBp: product.tax_rate_bp,
        taxInclusive: inclusive,
        discountPaise: line.discountPaise,
      };
    });

    const bill = calculateBill({
      lines,
      cartDiscountPaise: parsed.billDiscountPaise,
      isInterstate: this.isInterstate(supplier.stateCode),
      roundTotal: this.settings.tax.roundTotalToRupee,
    });

    if (parsed.payment && parsed.payment.amountPaise > bill.totalPaise) {
      throw new PurchaseError('OVERPAID', 'The payment is more than the bill total.');
    }

    const purchaseId = newId();
    const at = now();
    const purchaseDate = parsed.purchaseDateIso ?? at;
    const financialYear = financialYearOf(
      new Date(purchaseDate),
      this.settings.invoice.financialYearStartMonth,
    );

    inTransaction(this.db, () => {
      const purchaseNumber = this.repo.allocateNumber(
        this.ctx.branchId,
        'purchase',
        financialYear,
        'PUR',
      );

      this.repo.insertPurchase({
        id: purchaseId,
        branchId: this.ctx.branchId,
        supplierId: supplier.id,
        operatorId: this.ctx.operatorId,
        purchaseNumber,
        supplierBillNo: parsed.supplierBillNo ?? null,
        financialYear,
        purchaseDate,
        supplierName: supplier.name,
        supplierGstin: supplier.gstin,
        supplierStateCode: supplier.stateCode,
        taxMode: parsed.taxMode,
        isInterstate: bill.isInterstate ? 1 : 0,
        grossPaise: bill.grossPaise,
        itemDiscountPaise: bill.itemDiscountPaise,
        billDiscountPaise: bill.cartDiscountPaise,
        taxablePaise: bill.taxablePaise,
        cgstPaise: bill.cgstPaise,
        sgstPaise: bill.sgstPaise,
        igstPaise: bill.igstPaise,
        taxPaise: bill.taxPaise,
        roundOffPaise: bill.roundOffPaise,
        totalPaise: bill.totalPaise,
        notes: parsed.notes ?? null,
        idempotencyKey: parsed.idempotencyKey,
        at,
      });

      bill.lines.forEach((line, index) => {
        const source = parsed.lines[index];
        const product = line.productId ? products.get(line.productId) : undefined;
        if (!source || !product) return;

        this.repo.insertPurchaseItem({
          purchaseId,
          lineNo: line.lineNo,
          productId: line.productId,
          name: line.name,
          sku: line.sku,
          hsn: line.hsn,
          unitCode: line.unitCode,
          quantityMilli: line.quantityMilli,
          unitCostPaise: line.unitPricePaise,
          mrpPaise: source.mrpPaise ?? null,
          discountPaise: line.totalDiscountPaise,
          taxablePaise: line.taxablePaise,
          taxRateBp: line.taxRateBp,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          igstPaise: line.igstPaise,
          taxPaise: line.taxPaise,
          totalPaise: line.totalPaise,
          at,
        });

        // Stock arrives with the cost it arrived at, so a later valuation can
        // read the ledger rather than guess.
        const unitCost = Math.round((line.taxablePaise * 1000) / line.quantityMilli);
        if (product.track_inventory === 1 && line.productId) {
          this.catalogue.recordMovement({
            branchId: this.ctx.branchId,
            productId: line.productId,
            movementType: 'purchase',
            quantityMilli: line.quantityMilli,
            unitCostPaise: unitCost,
            referenceType: 'purchase',
            referenceId: purchaseId,
            reason: `Purchase ${purchaseNumber}`,
            operatorId: this.ctx.operatorId,
          });
        }

        if (line.productId) {
          this.repo.updateProductCost(line.productId, unitCost, source.mrpPaise ?? null);
          if (source.updateSellingPrice && source.mrpPaise) {
            this.repo.updateProductSellingPrice(line.productId, source.mrpPaise);
          }
        }
      });

      if (parsed.payment) {
        this.repo.insertSupplierPayment({
          supplierId: supplier.id,
          purchaseId,
          branchId: this.ctx.branchId,
          operatorId: this.ctx.operatorId,
          method: parsed.payment.method,
          amountPaise: parsed.payment.amountPaise,
          reference: parsed.payment.reference ?? null,
          notes: null,
          at,
        });
      }

      this.audit.record(
        {
          entityType: 'purchase',
          entityId: purchaseId,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: {
            purchaseNumber,
            supplier: supplier.name,
            supplierBillNo: parsed.supplierBillNo ?? null,
            totalPaise: bill.totalPaise,
            lines: bill.lines.length,
          },
        },
        at,
      );
    });

    const receipt = this.repo.findPurchase(purchaseId);
    if (!receipt) throw new PurchaseError('CREATE_FAILED', 'The purchase could not be read back.');
    return receipt;
  }

  getPurchase(id: string): PurchaseReceipt {
    const receipt = this.repo.findPurchase(id);
    if (!receipt) throw new PurchaseError('NOT_FOUND', 'Purchase not found.');
    return receipt;
  }

  listPurchases(input: unknown): PurchasePage {
    const query: PurchaseQuery = purchaseQuerySchema.parse(input ?? {});
    const result = this.repo.searchPurchases(query);
    return {
      items: result.items,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
      purchasedPaise: result.purchasedPaise,
      outstandingPaise: result.outstandingPaise,
    };
  }

  /**
   * Cancels a purchase: the row stays, the number stays, and the stock it
   * brought in goes back out.
   */
  cancelPurchase(input: unknown): PurchaseReceipt {
    const parsed = cancelPurchaseSchema.parse(input);

    const purchase = this.repo.findPurchase(parsed.id);
    if (!purchase) throw new PurchaseError('NOT_FOUND', 'Purchase not found.');
    if (purchase.status === 'cancelled') {
      throw new PurchaseError(
        'ALREADY_CANCELLED',
        `Purchase ${purchase.purchaseNumber} is already cancelled.`,
      );
    }
    if (this.repo.hasReturns(purchase.id)) {
      throw new PurchaseError(
        'HAS_RETURNS',
        `Purchase ${purchase.purchaseNumber} has a return against it, so it cannot be cancelled.`,
      );
    }
    if (purchase.paidPaise !== 0) {
      throw new PurchaseError(
        'ALREADY_PAID',
        'Money has been paid against this purchase. Record a refund from the supplier first.',
      );
    }

    const at = now();

    inTransaction(this.db, () => {
      this.repo.cancelPurchase(purchase.id, parsed.reason, this.ctx.operatorId, at);

      for (const movement of this.repo.purchaseMovements(purchase.id)) {
        this.catalogue.recordMovement({
          branchId: this.ctx.branchId,
          productId: movement.productId,
          movementType: 'adjustment',
          quantityMilli: -movement.quantityMilli,
          referenceType: 'purchase_cancel',
          referenceId: purchase.id,
          reason: `Cancelled ${purchase.purchaseNumber}: ${parsed.reason}`,
          operatorId: this.ctx.operatorId,
        });
      }

      this.audit.record(
        {
          entityType: 'purchase',
          entityId: purchase.id,
          action: 'cancel',
          operatorId: this.ctx.operatorId,
          details: {
            purchaseNumber: purchase.purchaseNumber,
            totalPaise: purchase.totalPaise,
            reason: parsed.reason,
          },
        },
        at,
      );
    });

    return this.getPurchase(purchase.id);
  }

  // ─── Returning to the supplier ──────────────────────────────────────────

  /**
   * Sends goods back. Value is reversed from the stored line in proportion to
   * what is left on it, so a sequence of partial returns credits the line
   * exactly — the same rule as a customer's return.
   */
  createReturn(input: unknown): PurchaseReturnReceipt {
    const parsed: PurchaseReturnInput = purchaseReturnInputSchema.parse(input);

    const already = this.repo.findReturnByIdempotencyKey(parsed.idempotencyKey);
    if (already) {
      const existing = this.repo.findReturn(already);
      if (existing) return { ...existing, duplicate: true };
    }

    const purchase = this.repo.findPurchase(parsed.purchaseId);
    if (!purchase) throw new PurchaseError('NOT_FOUND', 'Purchase not found.');
    if (purchase.status === 'cancelled') {
      throw new PurchaseError(
        'PURCHASE_CANCELLED',
        `Purchase ${purchase.purchaseNumber} was cancelled; the whole bill is already reversed.`,
      );
    }

    const byId = new Map(purchase.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();

    const priced = parsed.lines.map((line) => {
      if (seen.has(line.purchaseItemId)) {
        throw new PurchaseError('DUPLICATE_LINE', 'The same item appears twice in this return.');
      }
      seen.add(line.purchaseItemId);

      const bought = byId.get(line.purchaseItemId);
      if (!bought) throw new PurchaseError('LINE_NOT_FOUND', 'That item is not on this purchase.');

      const remainingQty = bought.quantityMilli - bought.returnedMilli;
      if (line.quantityMilli > remainingQty) {
        const precision = precisionFor(bought.unitCode);
        throw new PurchaseError(
          'EXCEEDS_PURCHASED',
          `Only ${formatQuantity(remainingQty, precision)} ${bought.unitCode} of ` +
            `${bought.name} can still be returned.`,
        );
      }

      // Already-returned value is not read back line by line: the share is of
      // what is left, measured by quantity, which lands on the exact total.
      const share = (value: number) =>
        line.quantityMilli >= remainingQty
          ? Math.round((value * remainingQty) / bought.quantityMilli)
          : Math.round((value * line.quantityMilli) / bought.quantityMilli);

      const taxable = share(bought.taxablePaise);
      const cgst = share(bought.cgstPaise);
      const sgst = share(bought.sgstPaise);
      const igst = share(bought.igstPaise);

      return {
        purchaseItemId: bought.id,
        productId: bought.productId,
        name: bought.name,
        unitCode: bought.unitCode,
        quantityMilli: line.quantityMilli,
        unitCostPaise: bought.unitCostPaise,
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        taxPaise: cgst + sgst + igst,
        totalPaise: taxable + cgst + sgst + igst,
      };
    });

    const taxablePaise = priced.reduce((a, l) => a + l.taxablePaise, 0);
    const cgstPaise = priced.reduce((a, l) => a + l.cgstPaise, 0);
    const sgstPaise = priced.reduce((a, l) => a + l.sgstPaise, 0);
    const igstPaise = priced.reduce((a, l) => a + l.igstPaise, 0);
    const taxPaise = cgstPaise + sgstPaise + igstPaise;
    const exact = taxablePaise + taxPaise;
    const rounded = this.settings.tax.roundTotalToRupee ? Math.round(exact / 100) * 100 : exact;
    const roundOffPaise = rounded - exact;

    const returnId = newId();
    const at = now();
    const financialYear = financialYearOf(
      new Date(at),
      this.settings.invoice.financialYearStartMonth,
    );

    inTransaction(this.db, () => {
      const returnNumber = this.repo.allocateNumber(
        this.ctx.branchId,
        'purchase_return',
        financialYear,
        'PRN',
      );

      this.repo.insertReturn({
        id: returnId,
        branchId: this.ctx.branchId,
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        operatorId: this.ctx.operatorId,
        returnNumber,
        financialYear,
        returnDate: at,
        reason: parsed.reason,
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        taxPaise,
        roundOffPaise,
        totalPaise: rounded,
        settlement: parsed.settlement,
        idempotencyKey: parsed.idempotencyKey,
      });

      for (const line of priced) {
        this.repo.insertReturnItem({ ...line, returnId, at });

        // Goods leaving the shelf: the ledger records it as an adjustment
        // against the credit note, because movement types are fixed by the
        // original schema and the reference says what it really was.
        if (line.productId) {
          this.catalogue.recordMovement({
            branchId: this.ctx.branchId,
            productId: line.productId,
            movementType: 'adjustment',
            quantityMilli: -line.quantityMilli,
            referenceType: 'purchase_return',
            referenceId: returnId,
            reason: `Returned to supplier on ${returnNumber}: ${parsed.reason}`,
            operatorId: this.ctx.operatorId,
          });
        }
      }

      // Money back now, rather than a debit note left on their account.
      if (parsed.settlement !== 'debit_note') {
        this.repo.insertSupplierPayment({
          supplierId: purchase.supplierId,
          purchaseId: purchase.id,
          branchId: this.ctx.branchId,
          operatorId: this.ctx.operatorId,
          method: parsed.settlement,
          amountPaise: -rounded,
          reference: returnNumber,
          notes: 'Refund from supplier against a return',
          at,
        });
      }

      this.audit.record(
        {
          entityType: 'purchase_return',
          entityId: returnId,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: {
            returnNumber,
            purchaseNumber: purchase.purchaseNumber,
            totalPaise: rounded,
            settlement: parsed.settlement,
            reason: parsed.reason,
          },
        },
        at,
      );
    });

    const receipt = this.repo.findReturn(returnId);
    if (!receipt) throw new PurchaseError('CREATE_FAILED', 'The return could not be read back.');
    return receipt;
  }

  getReturn(id: string): PurchaseReturnReceipt {
    const receipt = this.repo.findReturn(id);
    if (!receipt) throw new PurchaseError('NOT_FOUND', 'Return not found.');
    return receipt;
  }

  // ─── Paying ─────────────────────────────────────────────────────────────

  recordPayment(input: unknown): { id: string; outstandingPaise: number } {
    const parsed = supplierPaymentSchema.parse(input);

    const supplier = this.repo.findSupplier(parsed.supplierId);
    if (!supplier) throw new PurchaseError('SUPPLIER_NOT_FOUND', 'Supplier not found.');

    if (parsed.purchaseId) {
      const purchase = this.repo.findPurchase(parsed.purchaseId);
      if (!purchase) throw new PurchaseError('NOT_FOUND', 'Purchase not found.');
      if (purchase.supplierId !== parsed.supplierId) {
        throw new PurchaseError('WRONG_SUPPLIER', 'That bill belongs to a different supplier.');
      }
      if (purchase.status === 'cancelled') {
        throw new PurchaseError('CANCELLED', 'That purchase was cancelled.');
      }
      if (parsed.amountPaise > purchase.outstandingPaise) {
        throw new PurchaseError(
          'OVERPAID',
          'That is more than is outstanding on this bill. Leave it on account instead.',
        );
      }
    }

    const at = now();
    const id = inTransaction(this.db, () => {
      const paymentId = this.repo.insertSupplierPayment({
        supplierId: parsed.supplierId,
        purchaseId: parsed.purchaseId ?? null,
        branchId: this.ctx.branchId,
        operatorId: this.ctx.operatorId,
        method: parsed.method,
        amountPaise: parsed.amountPaise,
        reference: parsed.reference ?? null,
        notes: parsed.notes ?? null,
        at,
      });

      this.audit.record(
        {
          entityType: 'supplier',
          entityId: parsed.supplierId,
          action: 'payment',
          operatorId: this.ctx.operatorId,
          details: {
            supplier: supplier.name,
            amountPaise: parsed.amountPaise,
            method: parsed.method,
            reference: parsed.reference ?? null,
          },
        },
        at,
      );

      return paymentId;
    });

    return { id, outstandingPaise: this.repo.supplierOutstanding(parsed.supplierId) };
  }
}
