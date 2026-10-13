/**
 * Posting to the books.
 *
 * One rule governs everything here: a voucher's debits equal its credits, or
 * nothing is written. `post` refuses an unbalanced voucher before it touches
 * the database, and a test posts one of every kind of document and asserts the
 * trial balance comes to zero.
 *
 * Documents are the source and the books are derived, so posting is idempotent
 * and can be caught up: `postMissing` walks anything that has no voucher yet
 * and accounts for it. That is what runs after an update that adds the ledger
 * to a shop that already has months of sales.
 *
 * Inventory is accounted periodically — purchases are an expense, not an asset
 * movement — which is the convention the specification uses and the one a shop
 * of this size will recognise in its own books.
 */
import type { Database } from 'better-sqlite3';
import {
  ACCOUNTS,
  CHART_OF_ACCOUNTS,
  MONEY_ACCOUNT,
  accountInputSchema,
  journalSchema,
  ledgerQuerySchema,
  openingBalanceSchema,
  partyStatementSchema,
  USER_CODE_BASE,
  type Account,
  type AccountBalance,
  type LedgerQuery,
  type LedgerStatement,
  type PartyStatement,
  type VoucherInput,
  type VoucherLine,
} from '@shared/ledger';
import { financialYearOf, type AppSettings } from '@shared/settings';
import { newId, inTransaction } from '../db/repositories/base';
import { LedgerRepository } from '../db/repositories/ledger';
import { SettingsService } from './settings-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class LedgerService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: LedgerRepository;
  private readonly accountCache = new Map<string, Account>();

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new LedgerError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) throw new LedgerError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.settings = settings;

    this.repo = new LedgerRepository(db, ctx.companyId);

    // The posting rules refer to accounts by code, so the chart has to exist
    // before anything can be posted. Seeding is idempotent and only runs when
    // an account is actually missing.
    if (this.repo.accountByCode(ACCOUNTS.cash) === null) this.ensureChart();
  }

  /** Seeds the chart of accounts. Idempotent, so it runs on every start. */
  ensureChart(): number {
    return this.repo.ensureAccounts(CHART_OF_ACCOUNTS);
  }

  private account(code: string): Account {
    const cached = this.accountCache.get(code);
    if (cached) return cached;

    let found = this.repo.accountByCode(code);
    if (!found && CHART_OF_ACCOUNTS.some((a) => a.code === code)) {
      // A seeded account this version added, in a shop set up by an older one.
      // Seeding is idempotent, so filling the gap is cheaper than refusing.
      this.ensureChart();
      found = this.repo.accountByCode(code);
    }
    if (!found) {
      throw new LedgerError('NO_ACCOUNT', `The chart of accounts has no account ${code}.`);
    }
    this.accountCache.set(code, found);
    return found;
  }

  /**
   * What a document moved in points, as money. Earning raises what the shop
   * owes its customers; spending and reversals lower it. Read from the loyalty
   * transactions rather than passed in, so the books cannot disagree with the
   * card.
   */
  private loyaltyValue(referenceType: string, referenceId: string, kinds: string[]): number {
    const placeholders = kinds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS points
           FROM loyalty_transactions
          WHERE reference_type = ? AND reference_id = ? AND kind IN (${placeholders})`,
      )
      .get(referenceType, referenceId, ...kinds) as { points: number };

    const rate = this.settings.loyalty.paisePerPoint;
    return row.points * rate;
  }

  /** The two sides of a change in what the shop owes in points. */
  private loyaltyLines(valuePaise: number): VoucherLine[] {
    if (valuePaise === 0) return [];
    const amount = Math.abs(valuePaise);
    return valuePaise > 0
      ? [
          { accountCode: ACCOUNTS.loyaltyCost, debitPaise: amount },
          { accountCode: ACCOUNTS.loyalty, creditPaise: amount },
        ]
      : [
          { accountCode: ACCOUNTS.loyalty, debitPaise: amount },
          { accountCode: ACCOUNTS.loyaltyCost, creditPaise: amount },
        ];
  }

  accounts(): Account[] {
    return this.repo.accounts();
  }

  /**
   * Writes one voucher. Callers pass lines by account code; this resolves them,
   * checks the voucher balances, and refuses it if it does not.
   */
  post(input: VoucherInput): string {
    const debits = input.lines.reduce((a, l) => a + (l.debitPaise ?? 0), 0);
    const credits = input.lines.reduce((a, l) => a + (l.creditPaise ?? 0), 0);

    if (debits !== credits) {
      throw new LedgerError(
        'UNBALANCED',
        `A voucher must balance: ${debits} paise debit against ${credits} credit.`,
      );
    }
    if (debits === 0) {
      throw new LedgerError('EMPTY', 'A voucher with no amount is not a voucher.');
    }

    const voucherId = newId();
    const financialYear = financialYearOf(
      new Date(input.date),
      this.settings.invoice.financialYearStartMonth,
    );
    const voucherNo = this.repo.allocateVoucherNo(this.ctx.branchId, financialYear, 'V');

    this.repo.insertVoucher({
      id: voucherId,
      branchId: this.ctx.branchId,
      voucherNo,
      voucherDate: input.date,
      voucherType: input.type,
      narration: input.narration,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      operatorId: this.ctx.operatorId,
    });

    for (const line of input.lines) {
      if ((line.debitPaise ?? 0) === 0 && (line.creditPaise ?? 0) === 0) continue;
      this.repo.insertEntry({
        voucherId,
        branchId: this.ctx.branchId,
        entryDate: input.date,
        accountId: this.account(line.accountCode).id,
        debitPaise: line.debitPaise ?? 0,
        creditPaise: line.creditPaise ?? 0,
        partyType: line.partyType ?? null,
        partyId: line.partyId ?? null,
        narration: line.narration ?? null,
      });
    }

    return voucherId;
  }

  /** The round-off line, on whichever side it belongs. */
  private roundOffLine(roundOffPaise: number, gainIsCredit: boolean): VoucherLine[] {
    if (roundOffPaise === 0) return [];
    const amount = Math.abs(roundOffPaise);
    const credit = roundOffPaise > 0 ? gainIsCredit : !gainIsCredit;
    return [
      credit
        ? { accountCode: ACCOUNTS.roundOff, creditPaise: amount }
        : { accountCode: ACCOUNTS.roundOff, debitPaise: amount },
    ];
  }

  // ─── Selling ──────────────────────────────────────────────────────────────

  postSale(saleId: string): string | null {
    if (this.repo.hasVoucher('sale', saleId, 'sale')) return null;

    const sale = this.db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as
      Record<string, unknown> | undefined;
    if (!sale) throw new LedgerError('NOT_FOUND', 'Sale not found.');

    const payments = this.db
      .prepare('SELECT method, amount_paise, change_paise FROM payments WHERE sale_id = ?')
      .all(saleId) as { method: string; amount_paise: number; change_paise: number | null }[];

    const lines: VoucherLine[] = [];

    // Money actually kept: what was tendered less any change handed back.
    let received = 0;
    for (const payment of payments) {
      const amount = payment.amount_paise - (payment.change_paise ?? 0);
      if (amount === 0) continue;
      received += amount;
      lines.push({
        accountCode: MONEY_ACCOUNT[payment.method] ?? ACCOUNTS.cash,
        debitPaise: amount,
        // No line narration: the account already says how it was paid, so the
        // voucher's own narration — the invoice number — is the useful one.
      });
    }

    const total = sale['total_paise'] as number;
    if (received < total) {
      // Whatever the customer has not paid is owed to the shop.
      const customerId = (sale['customer_id'] as string | null) ?? null;
      lines.push(
        customerId
          ? {
              accountCode: ACCOUNTS.receivable,
              debitPaise: total - received,
              partyType: 'customer',
              partyId: customerId,
            }
          : { accountCode: ACCOUNTS.receivable, debitPaise: total - received },
      );
    }

    lines.push({ accountCode: ACCOUNTS.sales, creditPaise: sale['taxable_paise'] as number });
    if ((sale['tax_paise'] as number) > 0) {
      lines.push({ accountCode: ACCOUNTS.gstOutput, creditPaise: sale['tax_paise'] as number });
    }
    lines.push(...this.roundOffLine(sale['round_off_paise'] as number, true));

    lines.push(...this.loyaltyLines(this.loyaltyValue('sale', saleId, ['earn', 'redeem'])));

    return this.post({
      type: 'sale',
      date: sale['invoice_date'] as string,
      narration: `Sale ${sale['invoice_number'] as string}`,
      referenceType: 'sale',
      referenceId: saleId,
      lines,
    });
  }

  /** A void is accounted for by posting the sale's exact opposite. */
  postSaleVoid(saleId: string): string | null {
    if (this.repo.hasVoucher('sale', saleId, 'sale_void')) return null;

    const sale = this.db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as
      Record<string, unknown> | undefined;
    if (!sale || sale['status'] !== 'voided') return null;

    const payments = this.db
      .prepare('SELECT method, amount_paise, change_paise FROM payments WHERE sale_id = ?')
      .all(saleId) as { method: string; amount_paise: number; change_paise: number | null }[];

    const lines: VoucherLine[] = [];
    for (const payment of payments) {
      const amount = payment.amount_paise - (payment.change_paise ?? 0);
      if (amount === 0) continue;
      lines.push({
        accountCode: MONEY_ACCOUNT[payment.method] ?? ACCOUNTS.cash,
        creditPaise: amount,
      });
    }

    lines.push({ accountCode: ACCOUNTS.sales, debitPaise: sale['taxable_paise'] as number });
    if ((sale['tax_paise'] as number) > 0) {
      lines.push({ accountCode: ACCOUNTS.gstOutput, debitPaise: sale['tax_paise'] as number });
    }
    lines.push(...this.roundOffLine(sale['round_off_paise'] as number, false));
    lines.push(...this.loyaltyLines(this.loyaltyValue('sale', saleId, ['reverse'])));

    return this.post({
      type: 'sale_void',
      date: (sale['voided_at'] as string) ?? (sale['invoice_date'] as string),
      narration: `Void of ${sale['invoice_number'] as string}`,
      referenceType: 'sale',
      referenceId: saleId,
      lines,
    });
  }

  postSaleReturn(returnId: string): string | null {
    if (this.repo.hasVoucher('sale_return', returnId, 'sale_return')) return null;

    const credit = this.db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId) as
      Record<string, unknown> | undefined;
    if (!credit) throw new LedgerError('NOT_FOUND', 'Return not found.');

    const total = credit['total_paise'] as number;
    const method = credit['refund_method'] as string;

    const lines: VoucherLine[] = [
      { accountCode: ACCOUNTS.salesReturn, debitPaise: credit['taxable_paise'] as number },
    ];
    if ((credit['tax_paise'] as number) > 0) {
      lines.push({ accountCode: ACCOUNTS.gstOutput, debitPaise: credit['tax_paise'] as number });
    }
    lines.push(...this.roundOffLine(credit['round_off_paise'] as number, false));
    lines.push({ accountCode: MONEY_ACCOUNT[method] ?? ACCOUNTS.cash, creditPaise: total });
    lines.push(...this.loyaltyLines(this.loyaltyValue('sale_return', returnId, ['reverse'])));

    return this.post({
      type: 'sale_return',
      date: credit['return_date'] as string,
      narration: `Credit note ${credit['return_number'] as string}`,
      referenceType: 'sale_return',
      referenceId: returnId,
      lines,
    });
  }

  /**
   * A points correction made by hand. Earning and spending ride along with
   * their sale; an adjustment has no document of its own, so it gets a journal
   * voucher — otherwise what the shop owes in points and what the books say it
   * owes would drift apart on the first correction.
   */
  postLoyaltyAdjustment(transactionId: string): string | null {
    if (this.repo.hasVoucher('loyalty_adjustment', transactionId, 'journal')) return null;

    const value = this.loyaltyValue('manual', transactionId, ['adjust']);
    if (value === 0) return null;

    const row = this.db
      .prepare('SELECT created_at, narration FROM loyalty_transactions WHERE id = ?')
      .get(transactionId) as { created_at: string; narration: string | null } | undefined;
    if (!row) throw new LedgerError('NOT_FOUND', 'That points entry does not exist.');

    return this.post({
      type: 'journal',
      date: row.created_at,
      narration: `Points adjusted — ${row.narration ?? 'no reason given'}`,
      referenceType: 'loyalty_adjustment',
      referenceId: transactionId,
      lines: this.loyaltyLines(value),
    });
  }

  /**
   * Money received against a customer's account: the drawer or the bank goes
   * up, and what they owe comes down. The party is named on the receivable
   * line, so their own statement shows it.
   */
  postCustomerReceipt(receiptId: string): string | null {
    if (this.repo.hasVoucher('customer_receipt', receiptId, 'receipt')) return null;

    const receipt = this.db
      .prepare('SELECT * FROM customer_receipts WHERE id = ?')
      .get(receiptId) as Record<string, unknown> | undefined;
    if (!receipt) throw new LedgerError('NOT_FOUND', 'Receipt not found.');

    const amount = receipt['amount_paise'] as number;
    const money = MONEY_ACCOUNT[receipt['method'] as string] ?? ACCOUNTS.cash;
    const customerId = receipt['customer_id'] as string;
    const size = Math.abs(amount);
    const takenIn = amount > 0;

    const lines: VoucherLine[] = takenIn
      ? [
          { accountCode: money, debitPaise: size },
          {
            accountCode: ACCOUNTS.receivable,
            creditPaise: size,
            partyType: 'customer',
            partyId: customerId,
          },
        ]
      : [
          {
            accountCode: ACCOUNTS.receivable,
            debitPaise: size,
            partyType: 'customer',
            partyId: customerId,
          },
          { accountCode: money, creditPaise: size },
        ];

    return this.post({
      type: takenIn ? 'receipt' : 'payment',
      date: receipt['receipt_date'] as string,
      narration: `${takenIn ? 'Received' : 'Refunded'} by ${receipt['method'] as string}`,
      referenceType: 'customer_receipt',
      referenceId: receiptId,
      lines,
    });
  }

  // ─── Buying ───────────────────────────────────────────────────────────────

  postPurchase(purchaseId: string): string | null {
    if (this.repo.hasVoucher('purchase', purchaseId, 'purchase')) return null;

    const purchase = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as
      Record<string, unknown> | undefined;
    if (!purchase) throw new LedgerError('NOT_FOUND', 'Purchase not found.');

    // A registered shop can reclaim the tax it paid, so it is an asset. One
    // that is not registered cannot, so the same money is simply part of what
    // the goods cost.
    const reclaimable = this.settings.tax.registered;
    const taxable = purchase['taxable_paise'] as number;
    const tax = purchase['tax_paise'] as number;

    const lines: VoucherLine[] = [
      { accountCode: ACCOUNTS.purchases, debitPaise: reclaimable ? taxable : taxable + tax },
    ];
    if (reclaimable && tax > 0) {
      lines.push({ accountCode: ACCOUNTS.gstInput, debitPaise: tax });
    }
    lines.push(...this.roundOffLine(purchase['round_off_paise'] as number, false));
    lines.push({
      accountCode: ACCOUNTS.payable,
      creditPaise: purchase['total_paise'] as number,
      partyType: 'supplier',
      partyId: purchase['supplier_id'] as string,
    });

    return this.post({
      type: 'purchase',
      date: purchase['purchase_date'] as string,
      narration: `Purchase ${purchase['purchase_number'] as string}`,
      referenceType: 'purchase',
      referenceId: purchaseId,
      lines,
    });
  }

  postPurchaseCancel(purchaseId: string): string | null {
    if (this.repo.hasVoucher('purchase', purchaseId, 'purchase_cancel')) return null;

    const purchase = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as
      Record<string, unknown> | undefined;
    if (!purchase || purchase['status'] !== 'cancelled') return null;

    const lines: VoucherLine[] = [
      {
        accountCode: ACCOUNTS.payable,
        debitPaise: purchase['total_paise'] as number,
        partyType: 'supplier',
        partyId: purchase['supplier_id'] as string,
      },
      {
        accountCode: ACCOUNTS.purchases,
        creditPaise: this.settings.tax.registered
          ? (purchase['taxable_paise'] as number)
          : (purchase['taxable_paise'] as number) + (purchase['tax_paise'] as number),
      },
    ];
    if (this.settings.tax.registered && (purchase['tax_paise'] as number) > 0) {
      lines.push({ accountCode: ACCOUNTS.gstInput, creditPaise: purchase['tax_paise'] as number });
    }
    lines.push(...this.roundOffLine(purchase['round_off_paise'] as number, true));

    return this.post({
      type: 'purchase_cancel',
      date: (purchase['cancelled_at'] as string) ?? (purchase['purchase_date'] as string),
      narration: `Cancelled ${purchase['purchase_number'] as string}`,
      referenceType: 'purchase',
      referenceId: purchaseId,
      lines,
    });
  }

  postPurchaseReturn(returnId: string): string | null {
    if (this.repo.hasVoucher('purchase_return', returnId, 'purchase_return')) return null;

    const credit = this.db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId) as
      Record<string, unknown> | undefined;
    if (!credit) throw new LedgerError('NOT_FOUND', 'Purchase return not found.');

    const lines: VoucherLine[] = [
      {
        accountCode: ACCOUNTS.payable,
        debitPaise: credit['total_paise'] as number,
        partyType: 'supplier',
        partyId: credit['supplier_id'] as string,
      },
      {
        accountCode: ACCOUNTS.purchaseReturn,
        creditPaise: this.settings.tax.registered
          ? (credit['taxable_paise'] as number)
          : (credit['taxable_paise'] as number) + (credit['tax_paise'] as number),
      },
    ];
    if (this.settings.tax.registered && (credit['tax_paise'] as number) > 0) {
      lines.push({ accountCode: ACCOUNTS.gstInput, creditPaise: credit['tax_paise'] as number });
    }
    lines.push(...this.roundOffLine(credit['round_off_paise'] as number, true));

    return this.post({
      type: 'purchase_return',
      date: credit['return_date'] as string,
      narration: `Debit note ${credit['return_number'] as string}`,
      referenceType: 'purchase_return',
      referenceId: returnId,
      lines,
    });
  }

  /** Money to a supplier, or money back from one when the amount is negative. */
  postSupplierPayment(paymentId: string): string | null {
    if (this.repo.hasVoucher('supplier_payment', paymentId, 'payment')) return null;
    if (this.repo.hasVoucher('supplier_payment', paymentId, 'receipt')) return null;

    const payment = this.db
      .prepare('SELECT * FROM supplier_payments WHERE id = ?')
      .get(paymentId) as Record<string, unknown> | undefined;
    if (!payment) throw new LedgerError('NOT_FOUND', 'Payment not found.');

    const amount = payment['amount_paise'] as number;
    const money = MONEY_ACCOUNT[payment['method'] as string] ?? ACCOUNTS.cash;
    const supplierId = payment['supplier_id'] as string;
    const paidOut = amount > 0;
    const size = Math.abs(amount);

    const lines: VoucherLine[] = paidOut
      ? [
          {
            accountCode: ACCOUNTS.payable,
            debitPaise: size,
            partyType: 'supplier',
            partyId: supplierId,
          },
          { accountCode: money, creditPaise: size },
        ]
      : [
          { accountCode: money, debitPaise: size },
          {
            accountCode: ACCOUNTS.payable,
            creditPaise: size,
            partyType: 'supplier',
            partyId: supplierId,
          },
        ];

    // Named well enough to read on a supplier's account a month later: how it
    // was paid, and which bill it was set against if it was set against one.
    const against = payment['purchase_id']
      ? ((
          this.db
            .prepare('SELECT purchase_number FROM purchases WHERE id = ?')
            .get(payment['purchase_id'] as string) as { purchase_number: string } | undefined
        )?.purchase_number ?? null)
      : null;
    const how = `${paidOut ? 'Paid' : 'Refund'} by ${payment['method'] as string}`;

    return this.post({
      type: paidOut ? 'payment' : 'receipt',
      date: payment['payment_date'] as string,
      narration: against ? `${how} against ${against}` : `${how}, on account`,
      referenceType: 'supplier_payment',
      referenceId: paymentId,
      lines,
    });
  }

  // ─── Starting the books ───────────────────────────────────────────────────

  /**
   * What the shop held on the day the books start. Posted once; the balancing
   * side is equity, because the money came from somewhere before this system.
   */
  postOpeningBalances(input: unknown): string {
    const parsed = openingBalanceSchema.parse(input);

    if (this.repo.hasVoucher('opening', 'opening', 'opening')) {
      throw new LedgerError('ALREADY_OPENED', 'Opening balances have already been posted.');
    }

    const lines: VoucherLine[] = [];
    if (parsed.cashPaise > 0)
      lines.push({ accountCode: ACCOUNTS.cash, debitPaise: parsed.cashPaise });
    if (parsed.bankPaise > 0)
      lines.push({ accountCode: ACCOUNTS.bank, debitPaise: parsed.bankPaise });
    if (parsed.receivablePaise > 0) {
      lines.push({ accountCode: ACCOUNTS.receivable, debitPaise: parsed.receivablePaise });
    }
    if (parsed.payablePaise > 0) {
      lines.push({ accountCode: ACCOUNTS.payable, creditPaise: parsed.payablePaise });
    }

    const debits = lines.reduce((a, l) => a + (l.debitPaise ?? 0), 0);
    const credits = lines.reduce((a, l) => a + (l.creditPaise ?? 0), 0);
    const difference = debits - credits;

    if (difference > 0) {
      lines.push({ accountCode: ACCOUNTS.openingBalance, creditPaise: difference });
    } else if (difference < 0) {
      lines.push({ accountCode: ACCOUNTS.openingBalance, debitPaise: -difference });
    }

    return inTransaction(this.db, () =>
      this.post({
        type: 'opening',
        date: parsed.asOfIso,
        narration: 'Opening balances',
        referenceType: 'opening',
        referenceId: 'opening',
        lines,
      }),
    );
  }

  /**
   * An account the shop adds itself: rent, wages, a second bank. Assets and
   * expenses increase on the debit side; everything else on the credit side.
   */
  createAccount(input: unknown): Account {
    const parsed = accountInputSchema.parse(input);
    const normal: 'debit' | 'credit' =
      parsed.group === 'asset' || parsed.group === 'expense' ? 'debit' : 'credit';

    return inTransaction(this.db, () =>
      this.repo.insertAccount({
        name: parsed.name,
        group: parsed.group,
        normal,
        base: USER_CODE_BASE[parsed.group],
      }),
    );
  }

  /** A voucher entered by hand. Balanced or refused, like any other. */
  postJournal(input: unknown): string {
    const parsed = journalSchema.parse(input);

    for (const line of parsed.lines) {
      if (line.debitPaise > 0 && line.creditPaise > 0) {
        throw new LedgerError('TWO_SIDED_LINE', 'A line is a debit or a credit, not both.');
      }
    }

    return inTransaction(this.db, () =>
      this.post({
        type: 'journal',
        date: parsed.dateIso,
        narration: parsed.narration,
        lines: parsed.lines,
      }),
    );
  }

  // ─── Catching up ──────────────────────────────────────────────────────────

  /**
   * Accounts for every document that has no voucher yet, oldest first. Run
   * after an update that brings the ledger to a shop already trading, and
   * harmless on every start after that.
   */
  postMissing(): number {
    const pending = this.repo.unpostedDocuments();
    if (pending.length === 0) return 0;

    return inTransaction(this.db, () => {
      let posted = 0;
      for (const doc of pending) {
        const voucher =
          doc.kind === 'sale'
            ? this.postSale(doc.id)
            : doc.kind === 'sale_void'
              ? this.postSaleVoid(doc.id)
              : doc.kind === 'sale_return'
                ? this.postSaleReturn(doc.id)
                : doc.kind === 'purchase'
                  ? this.postPurchase(doc.id)
                  : doc.kind === 'purchase_cancel'
                    ? this.postPurchaseCancel(doc.id)
                    : doc.kind === 'purchase_return'
                      ? this.postPurchaseReturn(doc.id)
                      : doc.kind === 'customer_receipt'
                        ? this.postCustomerReceipt(doc.id)
                        : this.postSupplierPayment(doc.id);
        if (voucher) posted += 1;
      }
      return posted;
    });
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  trialBalance(fromIso: string, toIso: string): AccountBalance[] {
    return this.repo.trialBalance(fromIso, toIso);
  }

  statement(input: unknown): LedgerStatement {
    const query: LedgerQuery = ledgerQuerySchema.parse(input);
    const account = this.account(query.accountCode);
    const opening = this.repo.openingBalance(account.id, query.fromIso, account.normalBalance);

    let running = opening;
    const lines = this.repo
      .statementLines(account.id, query.fromIso, query.toIso, query.limit)
      .map((line) => {
        running +=
          account.normalBalance === 'debit'
            ? line.debitPaise - line.creditPaise
            : line.creditPaise - line.debitPaise;
        return { ...line, balancePaise: running };
      });

    return { account, openingPaise: opening, closingPaise: running, lines };
  }

  /**
   * One customer's or supplier's account. The control account carries every
   * party together, so a statement is the same reading narrowed to the party
   * named on each entry — which is what a shopkeeper means by "his account".
   */
  partyStatement(input: unknown): PartyStatement {
    const query = partyStatementSchema.parse(input);
    const account = this.account(
      query.partyType === 'customer' ? ACCOUNTS.receivable : ACCOUNTS.payable,
    );

    const table = query.partyType === 'customer' ? 'customers' : 'suppliers';
    const row = this.db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(query.partyId) as
      { name: string } | undefined;
    if (!row) throw new LedgerError('NOT_FOUND', 'That account does not exist.');

    const opening = this.repo.partyOpeningBalance(
      query.partyType,
      query.partyId,
      query.fromIso,
      account.normalBalance,
    );

    let running = opening;
    const lines = this.repo
      .partyStatementLines(query.partyType, query.partyId, query.fromIso, query.toIso, query.limit)
      .map((line) => {
        running +=
          account.normalBalance === 'debit'
            ? line.debitPaise - line.creditPaise
            : line.creditPaise - line.debitPaise;
        return { ...line, balancePaise: running };
      });

    return {
      partyType: query.partyType,
      partyId: query.partyId,
      partyName: row.name,
      account,
      openingPaise: opening,
      closingPaise: running,
      lines,
    };
  }

  dayBook(fromIso: string, toIso: string) {
    return this.repo.dayBook(fromIso, toIso);
  }
}
