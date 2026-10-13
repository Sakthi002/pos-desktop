/**
 * Sales returns.
 *
 * A return credits part or all of one invoice. Three rules shape everything
 * here:
 *
 *   1. Nothing can be returned that was not sold. Quantities are capped at the
 *      original line, less whatever came back earlier.
 *   2. Money is reversed from the stored invoice, never recalculated. If the
 *      price or the tax rate changed since, the customer is still refunded what
 *      they actually paid.
 *   3. Stock only moves when the operator says the goods can be sold again.
 *      A damaged item is refunded and never touches the shelf.
 *
 * The credit note, its lines, the refund and the restock movements commit in
 * one transaction, so a refund without a record cannot happen.
 */
import type { Database } from 'better-sqlite3';
import { apportion } from '@shared/billing';
import { financialYearOf, type AppSettings } from '@shared/settings';
import { formatQuantity, precisionFor } from '@shared/quantity';
import {
  returnInputSchema,
  type ReturnInput,
  type ReturnReceipt,
  type ReturnableSale,
} from '@shared/returns';
import { newId, now, inTransaction } from '../db/repositories/base';
import { ReturnsRepository, type SaleLineLedger } from '../db/repositories/returns';
import { CatalogueRepository } from '../db/repositories/catalogue';
import { AuditRepository } from '../db/repositories/audit';
import { SettingsService } from './settings-service';
import { LedgerService } from './ledger-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class ReturnError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnError';
  }
}

export class ReturnService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: ReturnsRepository;
  private readonly catalogue: CatalogueRepository;
  private readonly audit: AuditRepository;
  private readonly ledger: LedgerService;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new ReturnError('SETUP_INCOMPLETE', 'Complete setup before taking returns.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings)
      throw new ReturnError('SETUP_INCOMPLETE', 'Complete setup before taking returns.');
    this.settings = settings;

    this.repo = new ReturnsRepository(db, ctx.companyId);
    this.catalogue = new CatalogueRepository(db, ctx.companyId);
    this.audit = new AuditRepository(db);
    this.ledger = new LedgerService(db);
  }

  /** The invoice as a return screen needs it: what is left on each line. */
  getReturnableSale(saleId: string): ReturnableSale {
    const sale = this.repo.saleHeader(saleId);
    if (!sale) throw new ReturnError('NOT_FOUND', 'Sale not found.');

    const ledger = this.repo.saleLines(saleId);
    const lines = ledger.map((line) => ({
      saleItemId: line.saleItemId,
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unitCode: line.unitCode,
      soldMilli: line.soldMilli,
      returnedMilli: line.returnedMilli,
      returnableMilli: line.returnableMilli,
      unitPricePaise: line.unitPricePaise,
      taxRateBp: line.taxRateBp,
      taxablePaise: line.taxablePaise,
      taxPaise: line.taxPaise,
      totalPaise: line.totalPaise,
      trackInventory: line.trackInventory,
    }));

    return {
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber,
      invoiceDate: sale.invoiceDate,
      customerName: sale.customerName,
      status: sale.status,
      lines,
      priorReturns: this.repo.priorReturns(saleId),
      canReturn: sale.status === 'completed' && lines.some((l) => l.returnableMilli > 0),
    };
  }

  /**
   * The share of a line's remaining value that this return takes.
   *
   * Proportional to quantity, and measured against what is *left* rather than
   * the original, so a sequence of partial returns credits exactly the line
   * total — no paisa lost to rounding, none invented.
   */
  private shareOf(remainingValue: number, qty: number, remainingQty: number): number {
    if (qty >= remainingQty) return remainingValue;
    return apportion(remainingValue, [qty, remainingQty - qty])[0] as number;
  }

  createReturn(input: unknown): ReturnReceipt {
    const parsed: ReturnInput = returnInputSchema.parse(input);

    // A repeat submission resolves to the credit note already committed.
    const existing = this.repo.findByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      const receipt = this.repo.findReturn(existing);
      if (receipt) return { ...receipt, duplicate: true };
    }

    const sale = this.repo.saleHeader(parsed.saleId);
    if (!sale) throw new ReturnError('NOT_FOUND', 'Sale not found.');
    if (sale.status === 'voided') {
      throw new ReturnError(
        'SALE_VOIDED',
        `Invoice ${sale.invoiceNumber} was voided; the whole sale has already been reversed.`,
      );
    }

    const ledger = new Map(this.repo.saleLines(parsed.saleId).map((l) => [l.saleItemId, l]));

    const seen = new Set<string>();
    const priced = parsed.lines.map((line) => {
      if (seen.has(line.saleItemId)) {
        throw new ReturnError('DUPLICATE_LINE', 'The same item appears twice in this return.');
      }
      seen.add(line.saleItemId);

      const sold: SaleLineLedger | undefined = ledger.get(line.saleItemId);
      if (!sold) {
        throw new ReturnError('LINE_NOT_FOUND', 'That item is not on this invoice.');
      }
      if (line.quantityMilli > sold.returnableMilli) {
        const precision = precisionFor(sold.unitCode);
        throw new ReturnError(
          'EXCEEDS_SOLD',
          `Only ${formatQuantity(sold.returnableMilli, precision)} ${sold.unitCode} of ` +
            `${sold.name} can still be returned.`,
        );
      }

      const remainingQty = sold.returnableMilli;
      const taxable = this.shareOf(
        sold.taxablePaise - sold.returnedTaxablePaise,
        line.quantityMilli,
        remainingQty,
      );
      const cgst = this.shareOf(
        sold.cgstPaise - sold.returnedCgstPaise,
        line.quantityMilli,
        remainingQty,
      );
      const sgst = this.shareOf(
        sold.sgstPaise - sold.returnedSgstPaise,
        line.quantityMilli,
        remainingQty,
      );
      const igst = this.shareOf(
        sold.igstPaise - sold.returnedIgstPaise,
        line.quantityMilli,
        remainingQty,
      );

      return {
        saleItemId: sold.saleItemId,
        productId: sold.productId,
        name: sold.name,
        unitCode: sold.unitCode,
        quantityMilli: line.quantityMilli,
        unitPricePaise: sold.unitPricePaise,
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        taxPaise: cgst + sgst + igst,
        totalPaise: taxable + cgst + sgst + igst,
        // Only a tracked product can go back on a shelf; a service item cannot,
        // whatever the operator ticked.
        restocked: line.restock && sold.trackInventory && sold.productId !== null,
      };
    });

    const taxablePaise = priced.reduce((a, l) => a + l.taxablePaise, 0);
    const cgstPaise = priced.reduce((a, l) => a + l.cgstPaise, 0);
    const sgstPaise = priced.reduce((a, l) => a + l.sgstPaise, 0);
    const igstPaise = priced.reduce((a, l) => a + l.igstPaise, 0);
    const taxPaise = cgstPaise + sgstPaise + igstPaise;
    const exact = taxablePaise + taxPaise;

    // The invoice was rounded to the rupee, so the refund is too — a shop
    // cannot hand back 37 paise.
    const rounded = this.settings.tax.roundTotalToRupee ? Math.round(exact / 100) * 100 : exact;
    const roundOffPaise = rounded - exact;

    const returnId = newId();
    const at = now();
    const financialYear = financialYearOf(
      new Date(at),
      this.settings.invoice.financialYearStartMonth,
    );

    inTransaction(this.db, () => {
      const returnNumber = this.repo.allocateReturnNumber(
        sale.branchId,
        financialYear,
        `${this.settings.invoice.prefix}-RET`,
        this.settings.invoice.startNumber,
      );

      this.repo.insertReturn({
        id: returnId,
        branchId: sale.branchId,
        saleId: sale.id,
        operatorId: this.ctx.operatorId,
        returnNumber,
        financialYear,
        returnDate: at,
        reason: parsed.reason,
        refundMethod: parsed.refundMethod,
        taxablePaise,
        cgstPaise,
        sgstPaise,
        igstPaise,
        taxPaise,
        roundOffPaise,
        totalPaise: rounded,
        idempotencyKey: parsed.idempotencyKey,
      });

      for (const line of priced) {
        this.repo.insertReturnItem({
          returnId,
          saleItemId: line.saleItemId,
          productId: line.productId,
          quantityMilli: line.quantityMilli,
          unitPricePaise: line.unitPricePaise,
          taxablePaise: line.taxablePaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          igstPaise: line.igstPaise,
          taxPaise: line.taxPaise,
          totalPaise: line.totalPaise,
          restocked: line.restocked,
          at,
        });

        if (line.restocked && line.productId) {
          this.catalogue.recordMovement({
            branchId: sale.branchId,
            productId: line.productId,
            movementType: 'sale_return',
            quantityMilli: line.quantityMilli,
            referenceType: 'sale_return',
            referenceId: returnId,
            reason: `Return ${returnNumber} against ${sale.invoiceNumber}`,
            operatorId: this.ctx.operatorId,
          });
        }
      }

      this.repo.insertRefund({
        returnId,
        method: parsed.refundMethod,
        amountPaise: rounded,
        at,
      });

      this.ledger.postSaleReturn(returnId);

      this.audit.record(
        {
          entityType: 'sales_return',
          entityId: returnId,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: {
            returnNumber,
            invoiceNumber: sale.invoiceNumber,
            totalPaise: rounded,
            refundMethod: parsed.refundMethod,
            reason: parsed.reason,
            restockedLines: priced.filter((l) => l.restocked).length,
          },
        },
        at,
      );
    });

    const receipt = this.repo.findReturn(returnId);
    if (!receipt) throw new ReturnError('CREATE_FAILED', 'The return could not be read back.');
    return receipt;
  }

  getReturn(returnId: string): ReturnReceipt {
    const receipt = this.repo.findReturn(returnId);
    if (!receipt) throw new ReturnError('NOT_FOUND', 'Return not found.');
    return receipt;
  }
}
