/**
 * First-run setup.
 *
 * Creates the records every later feature assumes exist: a company, its branch,
 * an operator, the walk-in customer, and the invoice sequence. All of it in one
 * transaction, so a failure leaves the database untouched and setup can simply
 * be run again.
 */
import type { Database } from 'better-sqlite3';
import { appSettingsSchema, financialYearOf, type AppSettings } from '@shared/settings';
import { stateByCode } from '@shared/states';
import { STARTER_CATEGORIES } from '@shared/catalogue';
import { newId, now, inTransaction } from '../db/repositories/base';
import { SettingsService } from './settings-service';

export interface SetupState {
  isComplete: boolean;
  companyId: string | null;
  branchId: string | null;
}

export interface SetupResult {
  companyId: string;
  branchId: string;
  operatorId: string;
  settings: AppSettings;
}

export class SetupService {
  private readonly settings: SettingsService;

  constructor(private readonly db: Database) {
    this.settings = new SettingsService(db);
  }

  getState(): SetupState {
    const company = this.db.prepare('SELECT id FROM companies LIMIT 1').get() as
      { id: string } | undefined;
    const branch = company
      ? (this.db.prepare('SELECT id FROM branches WHERE company_id = ? LIMIT 1').get(company.id) as
          { id: string } | undefined)
      : undefined;

    return {
      isComplete: this.settings.isSetupComplete(),
      companyId: company?.id ?? null,
      branchId: branch?.id ?? null,
    };
  }

  complete(input: AppSettings): SetupResult {
    if (this.settings.isSetupComplete()) {
      throw new Error('Setup has already been completed');
    }

    const settings = appSettingsSchema.parse(input);
    const timestamp = now();
    const companyId = newId();
    const branchId = newId();
    const operatorId = newId();
    const stateName = stateByCode(settings.shop.stateCode)?.name ?? null;
    const gstin = settings.shop.gstin ? settings.shop.gstin : null;

    return inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO companies (id, name, legal_name, gstin, address, city, state, state_code,
             pincode, phone, email, created_at, updated_at)
           VALUES (@id, @name, @legal_name, @gstin, @address, @city, @state, @state_code,
             @pincode, @phone, @email, @t, @t)`,
        )
        .run({
          id: companyId,
          name: settings.shop.name,
          legal_name: settings.shop.legalName ?? null,
          gstin,
          address: settings.shop.address ?? null,
          city: settings.shop.city ?? null,
          state: stateName,
          state_code: settings.shop.stateCode,
          pincode: settings.shop.pincode || null,
          phone: settings.shop.phone ?? null,
          email: settings.shop.email ?? null,
          t: timestamp,
        });

      // A single-shop install still gets a branch: sales, stock and invoice
      // numbering are all scoped to one, and multi-branch later needs no migration.
      this.db
        .prepare(
          `INSERT INTO branches (id, company_id, code, name, gstin, address, state, state_code,
             phone, created_at, updated_at)
           VALUES (@id, @company_id, 'MAIN', @name, @gstin, @address, @state, @state_code,
             @phone, @t, @t)`,
        )
        .run({
          id: branchId,
          company_id: companyId,
          name: settings.shop.name,
          gstin,
          address: settings.shop.address ?? null,
          state: stateName,
          state_code: settings.shop.stateCode,
          phone: settings.shop.phone ?? null,
          t: timestamp,
        });

      // Sales record who rang them up. Operator login is not enabled in v1, so
      // this is an unauthenticated default rather than an account.
      this.db
        .prepare(
          `INSERT INTO operators (id, branch_id, name, username, role, created_at, updated_at)
           VALUES (?, ?, 'Owner', 'owner', 'admin', ?, ?)`,
        )
        .run(operatorId, branchId, timestamp, timestamp);

      this.db
        .prepare(
          `INSERT INTO customers (id, company_id, name, is_walk_in, created_at, updated_at)
           VALUES (?, ?, 'Walk-in Customer', 1, ?, ?)`,
        )
        .run(newId(), companyId, timestamp, timestamp);

      // Somewhere to file things from the first day. A guess at the trade, not
      // a rule: every one of these can be renamed or removed, and a product
      // never has to belong to one.
      const starters = STARTER_CATEGORIES[settings.shop.businessCategory] ?? [];
      const insertCategory = this.db.prepare(
        `INSERT INTO categories (id, company_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      );
      for (const name of starters) {
        insertCategory.run(newId(), companyId, name, timestamp, timestamp);
      }

      const financialYear = financialYearOf(new Date(), settings.invoice.financialYearStartMonth);
      for (const kind of ['sale', 'return'] as const) {
        this.db
          .prepare(
            `INSERT INTO invoice_sequences (branch_id, kind, financial_year, prefix, next_number)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            branchId,
            kind,
            financialYear,
            kind === 'sale' ? settings.invoice.prefix : `${settings.invoice.prefix}-RET`,
            settings.invoice.startNumber,
          );
      }

      this.settings.replaceAll(settings);
      this.settings.markSetupComplete();

      this.db
        .prepare(
          `INSERT INTO audit_logs (id, entity_type, entity_id, action, operator_id, details, created_at)
           VALUES (?, 'setup', ?, 'completed', ?, ?, ?)`,
        )
        .run(
          newId(),
          companyId,
          operatorId,
          JSON.stringify({ shop: settings.shop.name, stateCode: settings.shop.stateCode }),
          timestamp,
        );

      return { companyId, branchId, operatorId, settings };
    });
  }
}
