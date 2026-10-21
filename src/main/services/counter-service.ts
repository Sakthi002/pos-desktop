/**
 * The counter: what a customer owes, and what is in the drawer.
 *
 * Both are derived. What a customer owes is their credit bills, less credit
 * notes against them, less what has been received — never a stored balance. A
 * shift's expected cash is the float plus the cash the session took, less what
 * it refunded and anything paid out of the drawer, computed from the documents
 * when it is asked for.
 *
 * A counted drawer that disagrees with the expected figure is recorded as a
 * variance. It is never quietly corrected: noticing the difference is the
 * whole point of counting.
 */
import type { Database } from 'better-sqlite3';
import {
  closeShiftSchema,
  customerReceiptSchema,
  customerReceiptSplitSchema,
  openShiftSchema,
  type CustomerAccount,
  type CustomerReceipt,
  type Shift,
  type ShiftTakings,
} from '@shared/trade';
import { AuditRepository } from '../db/repositories/audit';
import { inTransaction, newId, now } from '../db/repositories/base';
import { LedgerService } from './ledger-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class CounterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CounterError';
  }
}

export class CounterService {
  private readonly ctx: BranchContext;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new CounterError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.ctx = ctx;
    this.audit = new AuditRepository(db);
  }

  // ─── What a customer owes ─────────────────────────────────────────────────

  account(customerId: string): CustomerAccount {
    const customer = this.db
      .prepare('SELECT id, name, credit_limit_paise FROM customers WHERE id = ?')
      .get(customerId) as { id: string; name: string; credit_limit_paise: number } | undefined;
    if (!customer) throw new CounterError('NOT_FOUND', 'That customer does not exist.');

    const bills = this.db
      .prepare(
        `SELECT s.id, s.invoice_number, s.invoice_date, s.total_paise, s.credit_paise,
                COALESCE((SELECT SUM(r.total_paise) FROM sales_returns r WHERE r.sale_id = s.id), 0)
                  AS credited,
                COALESCE((SELECT SUM(cr.amount_paise) FROM customer_receipts cr
                           WHERE cr.sale_id = s.id), 0) AS received
           FROM sales s
          WHERE s.customer_id = ? AND s.status = 'completed' AND s.credit_paise > 0
          ORDER BY s.invoice_date`,
      )
      .all(customerId) as {
      id: string;
      invoice_number: string;
      invoice_date: string;
      total_paise: number;
      credit_paise: number;
      credited: number;
      received: number;
    }[];

    // Receipts taken on account rather than against a bill.
    const onAccount = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) AS n FROM customer_receipts
            WHERE customer_id = ? AND sale_id IS NULL`,
        )
        .get(customerId) as { n: number }
    ).n;

    const billRows = bills.map((bill) => ({
      saleId: bill.id,
      invoiceNumber: bill.invoice_number,
      invoiceDate: bill.invoice_date,
      totalPaise: bill.total_paise,
      creditPaise: bill.credit_paise,
      outstandingPaise: Math.max(0, bill.credit_paise - bill.credited - bill.received),
    }));

    const outstanding =
      bills.reduce((a, b) => a + b.credit_paise - b.credited - b.received, 0) - onAccount;

    return {
      customerId: customer.id,
      customerName: customer.name,
      creditLimitPaise: customer.credit_limit_paise,
      outstandingPaise: outstanding,
      availablePaise:
        customer.credit_limit_paise > 0 ? customer.credit_limit_paise - outstanding : null,
      bills: billRows,
    };
  }

  /**
   * Whether a bill may be left part-paid. A walk-in cannot owe anything —
   * there is nobody to ask — and that is the whole of the rule. A shop lends
   * what it is willing to lend; the figure it goes by is what the customer
   * already owes, which the till puts in front of it.
   */
  assertCanOwe(customerId: string | null, creditPaise: number): void {
    if (creditPaise <= 0) return;

    if (!customerId) {
      throw new CounterError(
        'NO_CUSTOMER',
        'A bill can only be left unpaid against a named customer.',
      );
    }
  }

  receipts(customerId: string): CustomerReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, s.invoice_number
           FROM customer_receipts r
           LEFT JOIN sales s ON s.id = r.sale_id
          WHERE r.customer_id = ?
          ORDER BY r.receipt_date DESC`,
      )
      .all(customerId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row['id'] as string,
      customerId: row['customer_id'] as string,
      saleId: (row['sale_id'] as string | null) ?? null,
      invoiceNumber: (row['invoice_number'] as string | null) ?? null,
      receiptDate: row['receipt_date'] as string,
      method: row['method'] as string,
      amountPaise: row['amount_paise'] as number,
      reference: (row['reference'] as string | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
    }));
  }

  /** Money taken against an account, posted to the books as it is written. */
  recordReceipt(input: unknown): CustomerAccount {
    const parsed = customerReceiptSchema.parse(input);
    const account = this.account(parsed.customerId);

    if (parsed.saleId) {
      const bill = account.bills.find((b) => b.saleId === parsed.saleId);
      if (!bill) throw new CounterError('NOT_ON_ACCOUNT', 'That bill is not on this account.');
      if (parsed.amountPaise > bill.outstandingPaise) {
        throw new CounterError('OVER_BILL', 'That is more than is outstanding on this bill.');
      }
    } else if (parsed.amountPaise > account.outstandingPaise) {
      throw new CounterError('OVER_ACCOUNT', 'That is more than this customer owes.');
    }

    const id = newId();
    const at = now();

    inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO customer_receipts (id, company_id, branch_id, customer_id, sale_id,
             receipt_date, method, amount_paise, reference, notes, operator_id, created_at)
           VALUES (@id, @companyId, @branchId, @customerId, @saleId, @at, @method, @amount,
             @reference, @notes, @operatorId, @at)`,
        )
        .run({
          id,
          companyId: this.ctx.companyId,
          branchId: this.ctx.branchId,
          customerId: parsed.customerId,
          saleId: parsed.saleId ?? null,
          at,
          method: parsed.method,
          amount: parsed.amountPaise,
          reference: parsed.reference ?? null,
          notes: parsed.notes ?? null,
          operatorId: this.ctx.operatorId,
        });

      new LedgerService(this.db).postCustomerReceipt(id);

      this.audit.record(
        {
          entityType: 'customer_receipt',
          entityId: id,
          action: 'create',
          operatorId: this.ctx.operatorId,
          details: {
            customer: account.customerName,
            amountPaise: parsed.amountPaise,
            method: parsed.method,
          },
        },
        at,
      );
    });

    return this.account(parsed.customerId);
  }

  /**
   * The same money, handed over in more than one form. Each part is a receipt
   * of its own — the drawer counts the cash and only the cash — and because
   * every part is checked against what is left owing as the ones before it go
   * in, the last part cannot take the account past settled. One transaction,
   * so a UPI part that is refused does not leave the cash part recorded.
   */
  recordReceipts(input: unknown): CustomerAccount {
    const parsed = customerReceiptSplitSchema.parse(input);

    return inTransaction(this.db, () => {
      let account = this.account(parsed.customerId);
      for (const part of parsed.parts) {
        account = this.recordReceipt({
          customerId: parsed.customerId,
          saleId: parsed.saleId ?? null,
          method: part.method,
          amountPaise: part.amountPaise,
          reference: part.reference ?? null,
        });
      }
      return account;
    });
  }

  // ─── The drawer ───────────────────────────────────────────────────────────

  openShift(input: unknown): Shift {
    const parsed = openShiftSchema.parse(input);
    if (this.openShiftRow()) {
      throw new CounterError('ALREADY_OPEN', 'A shift is already open at this counter.');
    }

    const id = newId();
    const at = now();

    inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO shifts (id, company_id, branch_id, opened_by, opened_at,
             opening_float_paise, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.ctx.companyId,
          this.ctx.branchId,
          this.ctx.operatorId,
          at,
          parsed.openingFloatPaise,
          parsed.notes ?? null,
          at,
          at,
        );

      this.audit.record(
        {
          entityType: 'shift',
          entityId: id,
          action: 'open',
          operatorId: this.ctx.operatorId,
          details: { openingFloatPaise: parsed.openingFloatPaise },
        },
        at,
      );
    });

    return this.shift(id);
  }

  closeShift(input: unknown): Shift {
    const parsed = closeShiftSchema.parse(input);
    const shift = this.shift(parsed.id);
    if (shift.closedAt) throw new CounterError('ALREADY_CLOSED', 'That shift is already closed.');

    const expected = shift.takings.expectedPaise;
    const variance = parsed.countedPaise - expected;
    const at = now();

    inTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE shifts
              SET closed_by = ?, closed_at = ?, counted_paise = ?, expected_paise = ?,
                  variance_paise = ?, notes = COALESCE(?, notes), updated_at = ?
            WHERE id = ?`,
        )
        .run(
          this.ctx.operatorId,
          at,
          parsed.countedPaise,
          expected,
          variance,
          parsed.notes ?? null,
          at,
          parsed.id,
        );

      this.audit.record(
        {
          entityType: 'shift',
          entityId: parsed.id,
          action: 'close',
          operatorId: this.ctx.operatorId,
          details: {
            countedPaise: parsed.countedPaise,
            expectedPaise: expected,
            variancePaise: variance,
          },
        },
        at,
      );
    });

    return this.shift(parsed.id);
  }

  /** The shift a sale belongs to, or null when the shop does not run them. */
  currentShiftId(): string | null {
    return this.openShiftRow()?.id ?? null;
  }

  current(): Shift | null {
    const row = this.openShiftRow();
    return row ? this.shift(row.id) : null;
  }

  recent(limit = 20): Shift[] {
    const rows = this.db
      .prepare(`SELECT id FROM shifts WHERE branch_id = ? ORDER BY opened_at DESC LIMIT ?`)
      .all(this.ctx.branchId, limit) as { id: string }[];
    return rows.map((row) => this.shift(row.id));
  }

  shift(id: string): Shift {
    const row = this.db
      .prepare(
        `SELECT s.*, o.name AS opened_by_name, c.name AS closed_by_name
           FROM shifts s
           LEFT JOIN operators o ON o.id = s.opened_by
           LEFT JOIN operators c ON c.id = s.closed_by
          WHERE s.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new CounterError('NOT_FOUND', 'That shift does not exist.');

    const takings = this.takings(id, row['opening_float_paise'] as number);

    return {
      id,
      openedAt: row['opened_at'] as string,
      openedByName: (row['opened_by_name'] as string | null) ?? null,
      openingFloatPaise: row['opening_float_paise'] as number,
      closedAt: (row['closed_at'] as string | null) ?? null,
      closedByName: (row['closed_by_name'] as string | null) ?? null,
      countedPaise: (row['counted_paise'] as number | null) ?? null,
      expectedPaise: (row['expected_paise'] as number | null) ?? takings.expectedPaise,
      variancePaise: (row['variance_paise'] as number | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
      takings,
    };
  }

  /**
   * What a session took, by method. Cash is net of change given, because
   * change never stayed in the drawer; refunds and anything paid out of the
   * drawer during the session come off it.
   */
  private takings(shiftId: string, floatPaise: number): ShiftTakings {
    const sales = this.db
      .prepare(
        `SELECT COUNT(DISTINCT s.id) AS invoices,
                COALESCE(SUM(CASE WHEN p.method = 'cash'
                                  THEN p.amount_paise - COALESCE(p.change_paise, 0) ELSE 0 END), 0) AS cash,
                COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_paise ELSE 0 END), 0) AS card,
                COALESCE(SUM(CASE WHEN p.method = 'upi' THEN p.amount_paise ELSE 0 END), 0) AS upi,
                COALESCE(SUM(CASE WHEN p.method = 'bank' THEN p.amount_paise ELSE 0 END), 0) AS bank
           FROM sales s
           LEFT JOIN payments p ON p.sale_id = s.id
          WHERE s.shift_id = ? AND s.status = 'completed'`,
      )
      .get(shiftId) as {
      invoices: number;
      cash: number;
      card: number;
      upi: number;
      bank: number;
    };

    const credit = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(credit_paise), 0) AS n FROM sales
            WHERE shift_id = ? AND status = 'completed'`,
        )
        .get(shiftId) as { n: number }
    ).n;

    // Cash refunded on a credit note raised against a bill from this session.
    const refunded = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(p.amount_paise), 0) AS n
             FROM payments p
             JOIN sales_returns r ON r.id = p.return_id
             JOIN sales s ON s.id = r.sale_id
            WHERE s.shift_id = ? AND p.method = 'cash'`,
        )
        .get(shiftId) as { n: number }
    ).n;

    const row = this.db
      .prepare('SELECT opened_at, closed_at FROM shifts WHERE id = ?')
      .get(shiftId) as { opened_at: string; closed_at: string | null };
    const until = row.closed_at ?? now();

    // Cash that left the drawer for something other than a refund: a supplier
    // paid at the counter, or an expense entered by hand.
    const paidOut = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) AS n FROM supplier_payments
            WHERE method = 'cash' AND amount_paise > 0
              AND payment_date >= @from AND payment_date <= @to`,
        )
        .get({ from: row.opened_at, to: until }) as { n: number }
    ).n;

    const receipts = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) AS n FROM customer_receipts
            WHERE method = 'cash' AND receipt_date >= @from AND receipt_date <= @to`,
        )
        .get({ from: row.opened_at, to: until }) as { n: number }
    ).n;

    const cashIn = Math.abs(sales.cash) + receipts;

    return {
      invoices: sales.invoices,
      cashInPaise: cashIn,
      cashRefundedPaise: Math.abs(refunded),
      cashPaidOutPaise: paidOut,
      cardPaise: sales.card,
      upiPaise: sales.upi,
      bankPaise: sales.bank,
      creditPaise: credit,
      expectedPaise: floatPaise + cashIn - Math.abs(refunded) - paidOut,
    };
  }

  private openShiftRow(): { id: string } | null {
    const row = this.db
      .prepare('SELECT id FROM shifts WHERE branch_id = ? AND closed_at IS NULL')
      .get(this.ctx.branchId) as { id: string } | undefined;
    return row ?? null;
  }
}
