/**
 * The books, as storage.
 *
 * Writes are inserts and nothing else: the triggers refuse an update or a
 * delete, so this repository offers neither. Balances are summed from the
 * entries every time they are asked for.
 */
import type { Database } from 'better-sqlite3';
import type {
  Account,
  AccountBalance,
  AccountGroup,
  LedgerLine,
  SeedAccount,
  VoucherType,
} from '@shared/ledger';
import { Repository, newId, now, fromDbBool } from './base';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  account_group: string;
  normal_balance: string;
  is_system: number;
  is_active: number;
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  code: row.code,
  name: row.name,
  group: row.account_group as AccountGroup,
  normalBalance: row.normal_balance as 'debit' | 'credit',
  isSystem: fromDbBool(row.is_system),
  isActive: fromDbBool(row.is_active),
});

export class LedgerRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  /** Inserts any seeded account that is missing. Safe to call on every start. */
  ensureAccounts(seed: SeedAccount[]): number {
    const insert = this.db.prepare(
      `INSERT INTO accounts (id, company_id, code, name, account_group, normal_balance,
         is_system, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT (company_id, code) DO NOTHING`,
    );
    const t = now();
    let added = 0;
    for (const account of seed) {
      const result = insert.run(
        newId(),
        this.companyId,
        account.code,
        account.name,
        account.group,
        account.normal,
        t,
        t,
      );
      added += result.changes;
    }
    return added;
  }

  /** The shop's own account, numbered in the block its group owns. */
  insertAccount(input: {
    name: string;
    group: AccountGroup;
    normal: 'debit' | 'credit';
    base: number;
  }): Account {
    const taken = this.db
      .prepare(
        `SELECT code FROM accounts
          WHERE company_id = ? AND CAST(code AS INTEGER) >= ? AND CAST(code AS INTEGER) < ?`,
      )
      .all(this.companyId, input.base, input.base + 400) as { code: string }[];

    const used = new Set(taken.map((row) => Number(row.code)));
    let code = input.base;
    while (used.has(code)) code += 1;

    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO accounts (id, company_id, code, name, account_group, normal_balance,
           is_system, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      )
      .run(id, this.companyId, String(code), input.name, input.group, input.normal, t, t);

    return {
      id,
      code: String(code),
      name: input.name,
      group: input.group,
      normalBalance: input.normal,
      isSystem: false,
      isActive: true,
    };
  }

  accountByCode(code: string): Account | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE company_id = ? AND code = ?')
      .get(this.companyId, code) as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  accounts(): Account[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts WHERE company_id = ? ORDER BY code')
      .all(this.companyId) as AccountRow[];
    return rows.map(toAccount);
  }

  allocateVoucherNo(branchId: string, financialYear: string, prefix: string): string {
    const existing = this.db
      .prepare(
        'SELECT prefix, next_number FROM voucher_sequences WHERE branch_id = ? AND financial_year = ?',
      )
      .get(branchId, financialYear) as { prefix: string; next_number: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO voucher_sequences (branch_id, financial_year, prefix, next_number)
           VALUES (?, ?, ?, 2)`,
        )
        .run(branchId, financialYear, prefix);
      return `${prefix}-0001`;
    }

    this.db
      .prepare(
        `UPDATE voucher_sequences SET next_number = next_number + 1
          WHERE branch_id = ? AND financial_year = ?`,
      )
      .run(branchId, financialYear);

    return `${existing.prefix}-${String(existing.next_number).padStart(4, '0')}`;
  }

  insertVoucher(input: {
    id: string;
    branchId: string;
    voucherNo: string;
    voucherDate: string;
    voucherType: VoucherType;
    narration: string;
    referenceType: string | null;
    referenceId: string | null;
    operatorId: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO vouchers (id, company_id, branch_id, voucher_no, voucher_date, voucher_type,
           narration, reference_type, reference_id, operator_id, created_at)
         VALUES (@id, @companyId, @branchId, @voucherNo, @voucherDate, @voucherType,
           @narration, @referenceType, @referenceId, @operatorId, @voucherDate)`,
      )
      .run({ ...input, companyId: this.companyId });
  }

  insertEntry(input: {
    voucherId: string;
    branchId: string;
    entryDate: string;
    accountId: string;
    debitPaise: number;
    creditPaise: number;
    partyType: string | null;
    partyId: string | null;
    narration: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ledger_entries (id, voucher_id, company_id, branch_id, entry_date, account_id,
           debit_paise, credit_paise, party_type, party_id, narration, created_at)
         VALUES (@id, @voucherId, @companyId, @branchId, @entryDate, @accountId,
           @debitPaise, @creditPaise, @partyType, @partyId, @narration, @entryDate)`,
      )
      .run({ ...input, id: newId(), companyId: this.companyId });
  }

  /** True when this document has already been accounted for in this way. */
  hasVoucher(referenceType: string, referenceId: string, voucherType: VoucherType): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM vouchers
          WHERE reference_type = ? AND reference_id = ? AND voucher_type = ? LIMIT 1`,
      )
      .get(referenceType, referenceId, voucherType) as { found: number } | undefined;
    return row !== undefined;
  }

  voucherCount(): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM vouchers WHERE company_id = ?')
        .get(this.companyId) as {
        n: number;
      }
    ).n;
  }

  /** Every account with its movement in a range, and the balance it ends on. */
  trialBalance(fromIso: string, toIso: string): AccountBalance[] {
    const rows = this.db
      .prepare(
        `SELECT a.*,
                COALESCE(SUM(CASE WHEN e.entry_date <= @toIso AND e.entry_date >= @fromIso
                                  THEN e.debit_paise ELSE 0 END), 0) AS debit,
                COALESCE(SUM(CASE WHEN e.entry_date <= @toIso AND e.entry_date >= @fromIso
                                  THEN e.credit_paise ELSE 0 END), 0) AS credit
           FROM accounts a
           LEFT JOIN ledger_entries e ON e.account_id = a.id
          WHERE a.company_id = @companyId
          GROUP BY a.id
          ORDER BY a.code`,
      )
      .all({ companyId: this.companyId, fromIso, toIso }) as (AccountRow & {
      debit: number;
      credit: number;
    })[];

    return rows.map((row) => {
      const account = toAccount(row);
      const signed =
        account.normalBalance === 'debit' ? row.debit - row.credit : row.credit - row.debit;
      return {
        ...account,
        debitPaise: row.debit,
        creditPaise: row.credit,
        balancePaise: signed,
      };
    });
  }

  /** What an account did before a date, as a single figure. */
  openingBalance(accountId: string, beforeIso: string, normal: 'debit' | 'credit'): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(debit_paise), 0) AS debit, COALESCE(SUM(credit_paise), 0) AS credit
           FROM ledger_entries WHERE account_id = ? AND entry_date < ?`,
      )
      .get(accountId, beforeIso) as { debit: number; credit: number };
    return normal === 'debit' ? row.debit - row.credit : row.credit - row.debit;
  }

  statementLines(accountId: string, fromIso: string, toIso: string, limit: number): LedgerLine[] {
    const rows = this.db
      .prepare(
        `SELECT e.id, e.entry_date, e.debit_paise, e.credit_paise,
                -- A line carries its own narration only when it needs one; the
                -- voucher's is what names the document otherwise.
                COALESCE(e.narration, v.narration) AS narration,
                e.party_type, e.party_id, v.voucher_no, v.voucher_type, a.code, a.name
           FROM ledger_entries e
           JOIN vouchers v ON v.id = e.voucher_id
           JOIN accounts a ON a.id = e.account_id
          WHERE e.account_id = ? AND e.entry_date >= ? AND e.entry_date <= ?
          ORDER BY e.entry_date, v.voucher_no
          LIMIT ?`,
      )
      .all(accountId, fromIso, toIso, limit) as {
      id: string;
      entry_date: string;
      debit_paise: number;
      credit_paise: number;
      narration: string | null;
      party_type: string | null;
      party_id: string | null;
      voucher_no: string;
      voucher_type: string;
      code: string;
      name: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      voucherNo: row.voucher_no,
      voucherType: row.voucher_type as VoucherType,
      entryDate: row.entry_date,
      accountCode: row.code,
      accountName: row.name,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
      narration: row.narration,
      partyType: row.party_type,
      partyId: row.party_id,
      balancePaise: 0,
    }));
  }

  /** What a single customer or supplier owed, or was owed, before a date. */
  partyOpeningBalance(
    partyType: string,
    partyId: string,
    beforeIso: string,
    normal: 'debit' | 'credit',
  ): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(debit_paise), 0) AS debit, COALESCE(SUM(credit_paise), 0) AS credit
           FROM ledger_entries
          WHERE party_type = ? AND party_id = ? AND entry_date < ?`,
      )
      .get(partyType, partyId, beforeIso) as { debit: number; credit: number };
    return normal === 'debit' ? row.debit - row.credit : row.credit - row.debit;
  }

  /** One party's lines out of the control account, in the order they happened. */
  partyStatementLines(
    partyType: string,
    partyId: string,
    fromIso: string,
    toIso: string,
    limit: number,
  ): LedgerLine[] {
    const rows = this.db
      .prepare(
        `SELECT e.id, e.entry_date, e.debit_paise, e.credit_paise,
                -- A line carries its own narration only when it needs one; the
                -- voucher's is what names the document otherwise.
                COALESCE(e.narration, v.narration) AS narration,
                e.party_type, e.party_id, v.voucher_no, v.voucher_type, a.code, a.name
           FROM ledger_entries e
           JOIN vouchers v ON v.id = e.voucher_id
           JOIN accounts a ON a.id = e.account_id
          WHERE e.party_type = ? AND e.party_id = ?
            AND e.entry_date >= ? AND e.entry_date <= ?
          ORDER BY e.entry_date, v.voucher_no
          LIMIT ?`,
      )
      .all(partyType, partyId, fromIso, toIso, limit) as {
      id: string;
      entry_date: string;
      debit_paise: number;
      credit_paise: number;
      narration: string | null;
      party_type: string | null;
      party_id: string | null;
      voucher_no: string;
      voucher_type: string;
      code: string;
      name: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      voucherNo: row.voucher_no,
      voucherType: row.voucher_type as VoucherType,
      entryDate: row.entry_date,
      accountCode: row.code,
      accountName: row.name,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
      narration: row.narration,
      partyType: row.party_type,
      partyId: row.party_id,
      balancePaise: 0,
    }));
  }

  /** Every voucher in a range, with what it moved. */
  dayBook(
    fromIso: string,
    toIso: string,
  ): {
    voucher_no: string;
    voucher_date: string;
    voucher_type: string;
    narration: string | null;
    amount: number;
  }[] {
    return this.db
      .prepare(
        `SELECT v.voucher_no, v.voucher_date, v.voucher_type, v.narration,
                COALESCE((SELECT SUM(e.debit_paise) FROM ledger_entries e
                           WHERE e.voucher_id = v.id), 0) AS amount
           FROM vouchers v
          WHERE v.company_id = ? AND v.voucher_date >= ? AND v.voucher_date <= ?
          ORDER BY v.voucher_date DESC, v.voucher_no DESC`,
      )
      .all(this.companyId, fromIso, toIso) as {
      voucher_no: string;
      voucher_date: string;
      voucher_type: string;
      narration: string | null;
      amount: number;
    }[];
  }

  /** Documents that have not been accounted for yet, oldest first. */
  unpostedDocuments(): {
    kind:
      | 'sale'
      | 'sale_void'
      | 'sale_return'
      | 'purchase'
      | 'purchase_cancel'
      | 'purchase_return'
      | 'supplier_payment';
    id: string;
    at: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT 'sale' AS kind, s.id, s.invoice_date AS at FROM sales s
          WHERE s.company_id = @companyId
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'sale' AND v.reference_id = s.id
                               AND v.voucher_type = 'sale')
         UNION ALL
         SELECT 'sale_void', s.id, s.voided_at FROM sales s
          WHERE s.company_id = @companyId AND s.status = 'voided' AND s.voided_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'sale' AND v.reference_id = s.id
                               AND v.voucher_type = 'sale_void')
         UNION ALL
         SELECT 'sale_return', r.id, r.return_date FROM sales_returns r
          WHERE r.company_id = @companyId
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'sale_return' AND v.reference_id = r.id)
         UNION ALL
         SELECT 'purchase', p.id, p.purchase_date FROM purchases p
          WHERE p.company_id = @companyId
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'purchase' AND v.reference_id = p.id
                               AND v.voucher_type = 'purchase')
         UNION ALL
         SELECT 'purchase_cancel', p.id, p.cancelled_at FROM purchases p
          WHERE p.company_id = @companyId AND p.status = 'cancelled' AND p.cancelled_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'purchase' AND v.reference_id = p.id
                               AND v.voucher_type = 'purchase_cancel')
         UNION ALL
         SELECT 'purchase_return', r.id, r.return_date FROM purchase_returns r
          WHERE r.company_id = @companyId
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'purchase_return' AND v.reference_id = r.id)
         UNION ALL
         SELECT 'supplier_payment', sp.id, sp.payment_date FROM supplier_payments sp
          WHERE sp.company_id = @companyId
            AND NOT EXISTS (SELECT 1 FROM vouchers v
                             WHERE v.reference_type = 'supplier_payment' AND v.reference_id = sp.id)
         ORDER BY at`,
      )
      .all({ companyId: this.companyId }) as {
      kind: string;
      id: string;
      at: string;
    }[];

    return rows as ReturnType<LedgerRepository['unpostedDocuments']>;
  }
}
