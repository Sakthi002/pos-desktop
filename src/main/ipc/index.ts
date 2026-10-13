import { app, BrowserWindow } from 'electron';
import { registerHandler, IpcError } from './registry';
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
import { readLogo } from '../services/logo-service';
import { CatalogueService, CatalogueError } from '../services/catalogue-service';
import { SaleService, SaleError } from '../services/sale-service';
import { ReturnService, ReturnError } from '../services/return-service';
import { InventoryService, InventoryError } from '../services/inventory-service';
import { CustomerService, CustomerError } from '../services/customer-service';
import { ReportService, ReportError } from '../services/report-service';
import { DashboardService, DashboardError } from '../services/dashboard-service';
import { BackupService, BackupError } from '../services/backup-service';
import { AuditRepository } from '../db/repositories/audit';

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

  registerHandler('settings:update', (patch) => {
    const service = new SettingsService(getDatabase());
    if (!service.isSetupComplete()) {
      throw new IpcError('SETUP_INCOMPLETE', 'Complete setup before changing settings.');
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
  registerHandler('returns:create', (input) => asIpcError(() => returns().createReturn(input)));
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
