import { app, BrowserWindow } from 'electron';
import { registerHandler, setIpcGate, IpcError } from './registry';
import {
  getDbStatus,
  getDatabase,
  getDatabasePath,
  reopenDatabase,
  closeDatabase,
} from '../db/connection';
import { SettingsService } from '../services/settings-service';
import { SetupService } from '../services/setup-service';
import { pickLogo } from '../services/logo-service';
import { openCsv, saveCsv, pickDirectory, pickBackupFile } from '../services/file-service';
import { listPrinters, printDocument, exportPdf } from '../services/print-service';
import { buildReceiptHtml, type PaperSize } from '@shared/receipt';
import { sampleReceipt } from '@shared/sample-bill';
import type { AppSettings } from '@shared/settings';
import { buildLabelsHtml, type LabelRequest } from '@shared/labels';
import { readLogo } from '../services/logo-service';
import { CatalogueService, CatalogueError } from '../services/catalogue-service';
import { SaleService, SaleError } from '../services/sale-service';
import { ReturnService, ReturnError } from '../services/return-service';
import { InventoryService, InventoryError } from '../services/inventory-service';
import { CustomerService, CustomerError } from '../services/customer-service';
import { ReportService, ReportError } from '../services/report-service';
import { DashboardService, DashboardError } from '../services/dashboard-service';
import { SupplierService, SupplierError } from '../services/supplier-service';
import { PurchaseService, PurchaseError } from '../services/purchase-service';
import { LedgerService, LedgerError } from '../services/ledger-service';
import { LoyaltyService, LoyaltyError } from '../services/loyalty-service';
import { BatchService, BatchError } from '../services/batch-service';
import { CounterService, CounterError } from '../services/counter-service';
import { QuotationService, QuotationError } from '../services/quotation-service';
import { buildQuotationHtml } from '@shared/quotation-document';
import { BackupService, BackupError } from '../services/backup-service';
import { AuditRepository } from '../db/repositories/audit';
import { AuthService, AuthError } from '../services/auth-service';
import { UserRepository } from '../db/repositories/users';
import { CHANNEL_PERMISSIONS, PUBLIC_CHANNELS } from '@shared/permissions';
import { touch } from '../session';

export function registerIpcHandlers(): void {
  registerHandler('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));

  registerHandler('app:getDbStatus', () => getDbStatus());

  registerHandler('setup:getState', () => new SetupService(getDatabase()).getState());

  registerHandler('setup:complete', (settings) => {
    const service = new SetupService(getDatabase());
    if (service.getState().isComplete) {
      throw new IpcError('SETUP_ALREADY_COMPLETE', 'Setup has already been completed.');
    }
    return service.complete(settings);
  });

  registerHandler('settings:get', () => new SettingsService(getDatabase()).get());

  /** The shop's own mark, for the sidebar and the settings preview. */
  registerHandler('settings:logo', () => {
    const settings = new SettingsService(getDatabase()).get();
    const path = settings?.shop.logoPath;
    return { dataUrl: path ? readLogo(path) : null };
  });

  /**
   * The shop's template on a bill that never happened, so a theme can be seen
   * before it is saved. The sample is built here from the same engine the till
   * uses, and the draft template is validated like any other settings patch.
   */
  registerHandler('settings:templatePreview', (draft) => {
    const settings = new SettingsService(getDatabase()).get();
    if (!settings) throw new IpcError('SETUP_INCOMPLETE', 'Complete setup first.');

    // Only the keys the renderer actually sent: a partial schema re-applies
    // every default for the rest, which would reset what it did not mention.
    const sent = Object.fromEntries(
      Object.entries(draft).filter(([, value]) => value !== undefined),
    );
    const preview: AppSettings = { ...settings, template: { ...settings.template, ...sent } };
    return {
      html: buildReceiptHtml({
        receipt: sampleReceipt(),
        settings: preview,
        paperSize: 'a4',
        logoDataUrl: settings.shop.logoPath ? readLogo(settings.shop.logoPath) : null,
      }),
    };
  });

  registerHandler('settings:update', (patch) => {
    const service = new SettingsService(getDatabase());
    if (!service.isSetupComplete()) {
      throw new IpcError('SETUP_INCOMPLETE', 'Complete setup before changing settings.');
    }
    // Turning login on without an owner who can sign in would lock the shop
    // out of its own till, with no way back that does not involve us.
    if (patch.security?.requireLogin === true) {
      if (new UserRepository(getDatabase()).activeAdminsWithPassword() === 0) {
        throw new IpcError(
          'NO_ADMIN_PASSWORD',
          'Give an owner account a password before turning login on.',
        );
      }
    }
    return service.update(patch);
  });

  // One service instance per call: it reads the company/branch context on
  // construction, which must reflect the database as it is now.
  const catalogue = () => {
    try {
      return new CatalogueService(getDatabase());
    } catch (err) {
      if (err instanceof CatalogueError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('catalogue:listUnits', () => catalogue().listUnits());
  registerHandler('catalogue:listCategories', () => catalogue().listCategories());
  registerHandler('catalogue:createCategory', (input) => catalogue().createCategory(input));
  registerHandler('catalogue:renameCategory', ({ id, name }) =>
    catalogue().renameCategory(id, name),
  );
  registerHandler('catalogue:removeCategory', ({ id }) => catalogue().removeCategory(id));

  registerHandler('products:search', (query) => catalogue().search(query));
  registerHandler('products:get', ({ id }) => catalogue().get(id));
  registerHandler('products:create', (input) => catalogue().create(input));
  registerHandler('products:update', (input) => catalogue().update(input));
  registerHandler('products:setActive', ({ id, isActive }) => catalogue().setActive(id, isActive));
  registerHandler('products:remove', ({ id }) => catalogue().remove(id));
  registerHandler('products:adjustStock', (input) => catalogue().adjustStock(input));
  registerHandler('products:exportCsv', () => catalogue().exportCsv());
  registerHandler('products:importCsv', (input) => catalogue().importCsv(input));
  registerHandler('products:csvTemplate', () => catalogue().csvTemplate());

  const customers = () => new CustomerService(getDatabase());
  const saleService = () => {
    try {
      return new SaleService(getDatabase());
    } catch (err) {
      if (err instanceof SaleError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('customers:search', ({ term }) => customers().search(term));
  registerHandler('customers:walkIn', () => customers().walkIn());
  registerHandler('customers:create', (input) => customers().create(input));

  const customerCall = <T>(work: () => T): T => {
    try {
      return work();
    } catch (err) {
      if (err instanceof CustomerError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('customers:list', (query) => customerCall(() => customers().list(query)));
  registerHandler('customers:get', ({ id }) => customerCall(() => customers().get(id)));
  registerHandler('customers:update', (input) => customerCall(() => customers().update(input)));
  registerHandler('customers:setActive', ({ id, isActive }) =>
    customerCall(() => customers().setActive(id, isActive)),
  );

  // One instance per call: each reads the branch context as it is now.
  const buying = <T>(
    work: (services: { suppliers: SupplierService; purchases: PurchaseService }) => T,
  ): T => {
    try {
      const db = getDatabase();
      return work({ suppliers: new SupplierService(db), purchases: new PurchaseService(db) });
    } catch (err) {
      if (err instanceof SupplierError) throw new IpcError(err.code, err.message);
      if (err instanceof PurchaseError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('suppliers:list', (query) => buying(({ suppliers }) => suppliers.list(query)));
  registerHandler('suppliers:get', ({ id }) => buying(({ suppliers }) => suppliers.get(id)));
  registerHandler('suppliers:create', (input) =>
    buying(({ suppliers }) => suppliers.create(input)),
  );
  registerHandler('suppliers:update', (input) =>
    buying(({ suppliers }) => suppliers.update(input)),
  );
  registerHandler('suppliers:setActive', ({ id, isActive }) =>
    buying(({ suppliers }) => suppliers.setActive(id, isActive)),
  );
  registerHandler('suppliers:payments', ({ id }) =>
    buying(({ suppliers }) => suppliers.payments(id)),
  );

  registerHandler('purchases:create', (input) =>
    buying(({ purchases }) => purchases.createPurchase(input)),
  );
  registerHandler('purchases:search', (query) =>
    buying(({ purchases }) => purchases.listPurchases(query)),
  );
  registerHandler('purchases:get', ({ id }) =>
    buying(({ purchases }) => purchases.getPurchase(id)),
  );
  registerHandler('purchases:cancel', (input) =>
    buying(({ purchases }) => purchases.cancelPurchase(input)),
  );
  registerHandler('purchases:createReturn', (input) =>
    buying(({ purchases }) => purchases.createReturn(input)),
  );
  registerHandler('purchases:getReturn', ({ id }) =>
    buying(({ purchases }) => purchases.getReturn(id)),
  );
  registerHandler('purchases:payment', (input) =>
    buying(({ purchases }) => purchases.recordPayment(input)),
  );

  const auth = <T>(work: (service: AuthService) => T): T => {
    try {
      return work(new AuthService(getDatabase()));
    } catch (err) {
      if (err instanceof AuthError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  // Every channel passes this before its handler runs. A channel the shop can
  // use before signing in is listed as public; everything else needs a session
  // once login is on, and a role that allows the act if the channel names one.
  setIpcGate((channel) => {
    if (PUBLIC_CHANNELS.has(channel)) return;
    auth((service) => service.check(CHANNEL_PERMISSIONS[channel] ?? null));
    // Real work keeps the session alive; asking whether it is alive does not.
    touch();
  });

  /**
   * A cashier may undo a small mistake on their own; past the shop's threshold
   * somebody with the authority has to put their password behind it. Checked
   * here, where the value is known and the renderer cannot talk its way around
   * it — the generic channel gate cannot, because it never sees the payload.
   */
  const requireApproval = (
    permission: 'sale.void' | 'return.create',
    valuePaise: number,
    approval: unknown,
  ): void => {
    auth((service) => service.authorise(permission, valuePaise, approval));
  };

  registerHandler('auth:session', () => auth((service) => service.state()));
  registerHandler('auth:login', (input) => auth((service) => service.login(input)));
  registerHandler('auth:logout', () => auth((service) => service.logout()));
  registerHandler('auth:lock', () => auth((service) => service.lock()));
  registerHandler('auth:changePassword', (input) =>
    auth((service) => service.changePassword(input)),
  );

  registerHandler('users:list', () => auth((service) => service.list()));
  registerHandler('users:create', (input) => auth((service) => service.create(input)));
  registerHandler('users:update', (input) => auth((service) => service.update(input)));
  registerHandler('users:setActive', (input) => auth((service) => service.setActive(input)));
  registerHandler('users:resetPassword', (input) =>
    auth((service) => service.resetPassword(input)),
  );

  const quoting = <T>(work: (service: QuotationService) => T): T => {
    try {
      return work(new QuotationService(getDatabase()));
    } catch (err) {
      if (err instanceof QuotationError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  /** The quotation as a sheet, built here so the renderer sends no prices. */
  const quotationDocument = (id: string): { html: string; quotationNumber: string } => {
    const db = getDatabase();
    const settings = new SettingsService(db).require();
    const quotation = quoting((service) => service.get(id));
    return {
      html: buildQuotationHtml({
        quotation,
        settings,
        logoDataUrl: settings.shop.logoPath ? readLogo(settings.shop.logoPath) : null,
      }),
      quotationNumber: quotation.quotationNumber,
    };
  };

  registerHandler('quotations:create', (input) => quoting((service) => service.create(input)));
  registerHandler('quotations:list', (query) => quoting((service) => service.list(query)));
  registerHandler('quotations:get', ({ id }) => quoting((service) => service.get(id)));
  registerHandler('quotations:cancel', (input) => quoting((service) => service.cancel(input)));
  registerHandler('quotations:document', ({ id }) => ({ html: quotationDocument(id).html }));
  registerHandler('quotations:print', async ({ id, printerName }) =>
    printDocument(quotationDocument(id).html, 'a4', printerName ?? null, false),
  );
  registerHandler('quotations:exportPdf', async ({ id }) => {
    const sheet = quotationDocument(id);
    return exportPdf(focusedWindow(), sheet.html, 'a4', `${sheet.quotationNumber}.pdf`);
  });

  const counter = <T>(work: (service: CounterService) => T): T => {
    try {
      return work(new CounterService(getDatabase()));
    } catch (err) {
      if (err instanceof CounterError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('counter:account', ({ customerId }) =>
    counter((service) => service.account(customerId)),
  );
  registerHandler('counter:receipts', ({ customerId }) =>
    counter((service) => service.receipts(customerId)),
  );
  registerHandler('counter:receive', (input) => counter((service) => service.recordReceipt(input)));
  registerHandler('shift:current', () => counter((service) => service.current()));
  registerHandler('shift:recent', () => counter((service) => service.recent()));
  registerHandler('shift:open', (input) => counter((service) => service.openShift(input)));
  registerHandler('shift:close', (input) => counter((service) => service.closeShift(input)));

  const batched = <T>(work: (batches: BatchService) => T): T => {
    try {
      return work(new BatchService(getDatabase()));
    } catch (err) {
      if (err instanceof BatchError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('batches:list', (query) => batched((batches) => batches.list(query)));
  registerHandler('batches:save', (input) => batched((batches) => batches.ensure(input)));

  const points = <T>(work: (loyalty: LoyaltyService) => T): T => {
    try {
      return work(new LoyaltyService(getDatabase()));
    } catch (err) {
      if (err instanceof LoyaltyError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('loyalty:cards', () => points((loyalty) => loyalty.cards()));
  registerHandler('loyalty:forCustomer', ({ customerId }) =>
    points((loyalty) => loyalty.cardFor(customerId)),
  );
  registerHandler('loyalty:atTill', ({ customerId, billPaise }) =>
    points((loyalty) => loyalty.atTill(customerId, billPaise)),
  );
  registerHandler('loyalty:entries', ({ cardId }) => points((loyalty) => loyalty.entries(cardId)));
  registerHandler('loyalty:issue', (input) => points((loyalty) => loyalty.issueCard(input)));
  registerHandler('loyalty:update', (input) => points((loyalty) => loyalty.updateCard(input)));
  registerHandler('loyalty:adjust', (input) => points((loyalty) => loyalty.adjust(input)));

  const books = <T>(work: (ledger: LedgerService) => T): T => {
    try {
      return work(new LedgerService(getDatabase()));
    } catch (err) {
      if (err instanceof LedgerError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('ledger:accounts', () => books((ledger) => ledger.accounts()));
  registerHandler('ledger:trialBalance', ({ fromIso, toIso }) =>
    books((ledger) => ledger.trialBalance(fromIso, toIso)),
  );
  registerHandler('ledger:statement', (query) => books((ledger) => ledger.statement(query)));
  registerHandler('ledger:createAccount', (input) =>
    books((ledger) => ledger.createAccount(input)),
  );
  registerHandler('ledger:journal', (input) =>
    books((ledger) => ({ voucherId: ledger.postJournal(input) })),
  );
  registerHandler('ledger:partyStatement', (query) =>
    books((ledger) => ledger.partyStatement(query)),
  );
  registerHandler('ledger:openingBalances', (input) =>
    books((ledger) => ({ voucherId: ledger.postOpeningBalances(input) })),
  );

  registerHandler('dashboard:summary', (query) => {
    try {
      return new DashboardService(getDatabase()).summary(query);
    } catch (err) {
      if (err instanceof DashboardError) throw new IpcError(err.code, err.message);
      throw err;
    }
  });

  registerHandler('reports:run', (query) => {
    try {
      return new ReportService(getDatabase()).run(query);
    } catch (err) {
      if (err instanceof ReportError) throw new IpcError(err.code, err.message);
      throw err;
    }
  });

  registerHandler('sales:preview', (input) => saleService().preview(input));
  registerHandler('sales:create', (input) => {
    try {
      return saleService().createSale(input);
    } catch (err) {
      if (err instanceof SaleError) throw new IpcError(err.code, err.message);
      throw err;
    }
  });
  registerHandler('sales:getReceipt', ({ id }) => saleService().getReceipt(id));
  registerHandler('sales:search', (query) => saleService().listSales(query));
  registerHandler('sales:void', (input) => {
    try {
      // The value at stake decides whether a manager has to stand over this,
      // and it is read from the stored invoice, not from anything the renderer
      // sent — otherwise the threshold would be the renderer's to choose.
      const sale = saleService().getReceipt(input.id);
      requireApproval('sale.void', sale.bill.totalPaise, input.approval);
      return saleService().voidSale(input);
    } catch (err) {
      if (err instanceof SaleError) throw new IpcError(err.code, err.message);
      throw err;
    }
  });

  const returns = () => {
    try {
      return new ReturnService(getDatabase());
    } catch (err) {
      if (err instanceof ReturnError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  const asIpcError = <T>(work: () => T): T => {
    try {
      return work();
    } catch (err) {
      if (err instanceof ReturnError) throw new IpcError(err.code, err.message);
      if (err instanceof InventoryError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('returns:getSale', ({ saleId }) =>
    asIpcError(() => returns().getReturnableSale(saleId)),
  );
  registerHandler('returns:create', (input) =>
    asIpcError(() => {
      // What is being credited, priced from the stored invoice lines.
      const sale = returns().getReturnableSale(input.saleId);
      const value = input.lines.reduce((total, line) => {
        const original = sale.lines.find((l) => l.saleItemId === line.saleItemId);
        if (!original || original.soldMilli === 0) return total;
        return total + Math.round((original.totalPaise * line.quantityMilli) / original.soldMilli);
      }, 0);
      requireApproval('return.create', value, input.approval);
      return returns().createReturn(input);
    }),
  );
  registerHandler('returns:get', ({ id }) => asIpcError(() => returns().getReturn(id)));

  registerHandler('inventory:movements', (query) =>
    asIpcError(() => new InventoryService(getDatabase()).movements(query)),
  );
  registerHandler('inventory:lowStock', () =>
    asIpcError(() => new InventoryService(getDatabase()).lowStock()),
  );

  /**
   * Builds the document for a stored sale. Preview, PDF and print all go
   * through here, so none of them can render different totals.
   */
  const documentFor = (saleId: string, paperSize?: PaperSize, isReprint?: boolean) => {
    const db = getDatabase();
    const settings = new SettingsService(db).get();
    if (!settings) throw new IpcError('SETUP_INCOMPLETE', 'Complete setup first.');

    const receipt = saleService().getReceipt(saleId);
    const size = paperSize ?? settings.receipt.paperSize;
    const logoDataUrl = settings.shop.logoPath ? readLogo(settings.shop.logoPath) : null;

    return {
      html: buildReceiptHtml({
        receipt,
        settings,
        paperSize: size,
        logoDataUrl,
        isReprint: isReprint ?? false,
      }),
      paperSize: size,
      invoiceNumber: receipt.invoiceNumber,
    };
  };

  registerHandler('print:listPrinters', async () => listPrinters(focusedWindow()));

  /**
   * Shelf labels. The products are read here rather than trusted from the
   * renderer, so a label always carries the price the till would charge.
   */
  const labelSheet = (request: LabelRequest): string => {
    const db = getDatabase();
    const settings = new SettingsService(db).require();
    const ids = request.items.map((i) => i.productId);
    const placeholders = ids.map(() => '?').join(',');

    const rows = db
      .prepare(
        `SELECT id, name, sku, barcode, price_paise, mrp_paise, wholesale_price_paise,
                special_price_paise, unit_code
           FROM products WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[];

    return buildLabelsHtml({
      request,
      settings,
      products: rows.map((row) => ({
        id: row['id'] as string,
        name: row['name'] as string,
        sku: (row['sku'] as string | null) ?? null,
        barcode: (row['barcode'] as string | null) ?? null,
        pricePaise: row['price_paise'] as number,
        mrpPaise: (row['mrp_paise'] as number | null) ?? null,
        wholesalePricePaise: (row['wholesale_price_paise'] as number | null) ?? null,
        specialPricePaise: (row['special_price_paise'] as number | null) ?? null,
        unitCode: row['unit_code'] as string,
      })),
    });
  };

  registerHandler('labels:preview', (request) => ({ html: labelSheet(request) }));

  registerHandler('labels:exportPdf', async (request) =>
    exportPdf(focusedWindow(), labelSheet(request), 'a4', 'shelf-labels.pdf'),
  );

  registerHandler('labels:print', async ({ printerName, ...request }) =>
    printDocument(labelSheet(request), 'a4', printerName ?? null, false),
  );

  registerHandler('print:previewHtml', ({ saleId, paperSize, isReprint }) => {
    const doc = documentFor(saleId, paperSize, isReprint);
    return { html: doc.html, paperSize: doc.paperSize };
  });

  registerHandler(
    'print:receipt',
    async ({ saleId, paperSize, printerName, silent, isReprint }) => {
      const doc = documentFor(saleId, paperSize, isReprint);
      return printDocument(doc.html, doc.paperSize, printerName ?? null, silent ?? false);
    },
  );

  registerHandler('print:exportPdf', async ({ saleId, paperSize, isReprint }) => {
    const doc = documentFor(saleId, paperSize, isReprint);
    return exportPdf(focusedWindow(), doc.html, doc.paperSize, `${doc.invoiceNumber}.pdf`);
  });

  registerHandler('print:testPage', async ({ printerName, silent }) => {
    const settings = new SettingsService(getDatabase()).get();
    if (!settings) throw new IpcError('SETUP_INCOMPLETE', 'Complete setup first.');

    const html = `<!doctype html><html><head><meta charset="utf-8">
      <style>@page{margin:0}body{font-family:'Courier New',monospace;padding:6mm;font-size:12px;text-align:center}
      .r{border-top:1px dashed #000;margin:3mm 0}</style></head><body>
      <strong>${settings.shop.name}</strong><div class="r"></div>
      <div>PRINTER TEST</div><div>${new Date().toLocaleString()}</div>
      <div class="r"></div><div>If you can read this,<br>printing works.</div>
      </body></html>`;

    return printDocument(html, settings.receipt.paperSize, printerName ?? null, silent ?? false);
  });

  registerHandler('dialog:openCsv', async () => {
    const window = focusedWindow();
    return openCsv(window);
  });

  registerHandler('dialog:saveCsv', async ({ suggestedName, content }) => {
    const window = focusedWindow();
    return saveCsv(window, suggestedName, content);
  });

  registerHandler('dialog:pickLogo', async () => {
    return pickLogo(focusedWindow());
  });


  registerHandler('dialog:pickBackupDirectory', async () => pickDirectory(focusedWindow()));
  registerHandler('dialog:pickBackupFile', async () => pickBackupFile(focusedWindow()));

  const backups = () =>
    new BackupService({
      db: () => getDatabase(),
      dbPath: getDatabasePath(),
      appVersion: app.getVersion(),
      closeDb: closeDatabase,
      openDb: reopenDatabase,
    });

  const backupCall = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if (err instanceof BackupError) throw new IpcError(err.code, err.message);
      throw err;
    }
  };

  registerHandler('backup:run', async (input) => backupCall(() => backups().run(input)));
  registerHandler('backup:list', async () => backupCall(() => backups().list()));
  registerHandler('backup:inspect', async ({ path }) => backupCall(() => backups().inspect(path)));
  registerHandler('backup:restore', async (input) => backupCall(() => backups().restore(input)));

  registerHandler('audit:list', ({ page, pageSize }) => {
    const repo = new AuditRepository(getDatabase());
    return {
      items: repo.list(pageSize, (page - 1) * pageSize).map((entry) => ({
        id: entry.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        operatorName: entry.operatorName,
        details: entry.details,
        createdAt: entry.createdAt,
      })),
      total: repo.count(),
      page,
      pageSize,
    };
  });
}

function focusedWindow(): BrowserWindow {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window) throw new IpcError('NO_WINDOW', 'No window available for the file dialog.');
  return window;
}
