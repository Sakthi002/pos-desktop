/**
 * The complete IPC surface between renderer and main.
 *
 * Every channel declares a Zod schema for its request payload. The main process
 * validates against that schema before a handler runs, so a compromised or buggy
 * renderer cannot reach a handler with a shape it does not expect.
 *
 * Adding a channel means adding it here first. There is no other way in.
 */
import { z } from 'zod';
import {
  appSettingsSchema,
  settingsPatchSchema,
  templateSchema,
  type AppSettings,
} from './settings';
import {
  categoryInputSchema,
  csvImportSchema,
  productInputSchema,
  productQuerySchema,
  productUpdateSchema,
  stockAdjustmentSchema,
  type Category,
  type CsvImportResult,
  type Product,
  type ProductPage,
  type Unit,
} from './catalogue';
import {
  saleInputSchema,
  billPreviewSchema,
  saleQuerySchema,
  voidSaleSchema,
  type SaleReceipt,
  type SalePage,
} from './sale';
import {
  customerInputSchema,
  customerQuerySchema,
  customerUpdateSchema,
  type Customer,
  type CustomerPage,
} from './customer';
import { reportQuerySchema, type ReportTable } from './reports';
import { dashboardQuerySchema, type DashboardSummary } from './dashboard';
import { batchInputSchema, batchQuerySchema, type Batch } from './batches';
import { labelRequestSchema } from './labels';
import {
  cancelQuotationSchema,
  quotationInputSchema,
  quotationQuerySchema,
  type Quotation,
  type QuotationPage,
} from './quotations';
import {
  cancelPurchaseOrderSchema,
  purchaseOrderInputSchema,
  purchaseOrderQuerySchema,
  type PurchaseOrder,
  type PurchaseOrderPage,
} from './purchase-orders';
import {
  closeShiftSchema,
  customerReceiptSchema,
  openShiftSchema,
  type CustomerAccount,
  type CustomerReceipt,
  type Shift,
} from './trade';
import {
  adjustPointsSchema,
  issueCardSchema,
  updateCardSchema,
  type LoyaltyAtTill,
  type LoyaltyCard,
  type LoyaltyEntry,
} from './loyalty';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  resetPasswordSchema,
  setUserActiveSchema,
  updateUserSchema,
  type SessionState,
  type UserSummary,
} from './auth';
import {
  accountInputSchema,
  journalSchema,
  ledgerQuerySchema,
  openingBalanceSchema,
  partyStatementSchema,
  type Account,
  type AccountBalance,
  type LedgerStatement,
  type PartyStatement,
} from './ledger';
import {
  cancelPurchaseSchema,
  purchaseInputSchema,
  purchaseQuerySchema,
  purchaseReturnInputSchema,
  supplierInputSchema,
  supplierPaymentSchema,
  supplierQuerySchema,
  supplierUpdateSchema,
  type PurchasePage,
  type PurchaseReceipt,
  type PurchaseReturnReceipt,
  type Supplier,
  type SupplierPage,
  type SupplierPayment,
} from './purchasing';
import {
  backupRunSchema,
  restoreSchema,
  type BackupFile,
  type BackupInspection,
  type BackupResult,
  type RestoreResult,
} from './backup';
import { returnInputSchema, type ReturnReceipt, type ReturnableSale } from './returns';
import { movementQuerySchema, type LowStockItem, type MovementPage } from './inventory';
import type { Bill } from './billing';
import type { PaperSize } from './receipt';

/** Payload schemas, keyed by channel name. */
/**
 * What is being sent, and which document it is. A statement is identified by
 * the customer it belongs to, because it is drawn fresh every time rather than
 * stored — the other three are documents the shop has already issued.
 */
export const whatsappTargetSchema = z.object({
  kind: z.enum(['sale', 'quotation', 'purchaseOrder', 'statement']),
  id: z.string().uuid(),
});

export const ipcContract = {
  'app:getInfo': z.void(),
  'app:getDbStatus': z.void(),

  'setup:getState': z.void(),
  'setup:complete': appSettingsSchema,

  'settings:get': z.void(),
  'settings:update': settingsPatchSchema,
  'settings:logo': z.void(),
  'settings:templatePreview': templateSchema.partial(),

  'dialog:pickLogo': z.void(),
  'dialog:pickBackupDirectory': z.void(),
  'dialog:pickBackupFile': z.void(),
  'dialog:openCsv': z.void(),
  'dialog:saveCsv': z.object({
    suggestedName: z.string().min(1).max(120),
    content: z.string(),
  }),

  'catalogue:listUnits': z.void(),
  'catalogue:listCategories': z.void(),
  'catalogue:createCategory': categoryInputSchema,
  'catalogue:renameCategory': z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  'catalogue:removeCategory': z.object({ id: z.string().uuid() }),

  'products:search': productQuerySchema.partial(),
  'products:get': z.object({ id: z.string().uuid() }),
  'products:create': productInputSchema,
  'products:update': productUpdateSchema,
  'products:setActive': z.object({ id: z.string().uuid(), isActive: z.boolean() }),
  'products:remove': z.object({ id: z.string().uuid() }),
  'products:adjustStock': stockAdjustmentSchema,
  'products:exportCsv': z.void(),
  'products:importCsv': csvImportSchema,
  'products:csvTemplate': z.void(),

  'customers:search': z.object({ term: z.string().max(100).default('') }),
  'customers:walkIn': z.void(),
  'customers:create': customerInputSchema,
  'customers:list': customerQuerySchema.partial(),
  'customers:get': z.object({ id: z.string().uuid() }),
  'customers:update': customerUpdateSchema,
  'customers:setActive': z.object({ id: z.string().uuid(), isActive: z.boolean() }),

  'sales:preview': billPreviewSchema,
  'sales:create': saleInputSchema,
  'sales:getReceipt': z.object({ id: z.string().uuid() }),
  'sales:search': saleQuerySchema.partial(),
  'sales:void': voidSaleSchema,

  'returns:getSale': z.object({ saleId: z.string().uuid() }),
  'returns:create': returnInputSchema,
  'returns:get': z.object({ id: z.string().uuid() }),

  'inventory:movements': movementQuerySchema,
  'inventory:lowStock': z.void(),

  'reports:run': reportQuerySchema,
  'dashboard:summary': dashboardQuerySchema,

  'suppliers:list': supplierQuerySchema.partial(),
  'suppliers:get': z.object({ id: z.string().uuid() }),
  'suppliers:create': supplierInputSchema,
  'suppliers:update': supplierUpdateSchema,
  'suppliers:setActive': z.object({ id: z.string().uuid(), isActive: z.boolean() }),
  'suppliers:payments': z.object({ id: z.string().uuid() }),

  'purchases:create': purchaseInputSchema,
  'purchases:search': purchaseQuerySchema.partial(),
  'purchases:get': z.object({ id: z.string().uuid() }),
  'purchases:cancel': cancelPurchaseSchema,
  'purchases:createReturn': purchaseReturnInputSchema,
  'purchases:getReturn': z.object({ id: z.string().uuid() }),
  'purchases:payment': supplierPaymentSchema,

  'auth:session': z.void(),
  'auth:login': loginSchema,
  'auth:logout': z.void(),
  'auth:lock': z.void(),
  'auth:changePassword': changePasswordSchema,

  'users:list': z.void(),
  'users:create': createUserSchema,
  'users:update': updateUserSchema,
  'users:setActive': setUserActiveSchema,
  'users:resetPassword': resetPasswordSchema,

  'purchaseOrders:create': purchaseOrderInputSchema,
  'purchaseOrders:list': purchaseOrderQuerySchema.partial(),
  'purchaseOrders:get': z.object({ id: z.string().uuid() }),
  'purchaseOrders:cancel': cancelPurchaseOrderSchema,
  'purchaseOrders:document': z.object({ id: z.string().uuid() }),
  'purchaseOrders:print': z.object({
    id: z.string().uuid(),
    printerName: z.string().max(200).nullable().optional(),
  }),
  'purchaseOrders:exportPdf': z.object({ id: z.string().uuid() }),

  'quotations:create': quotationInputSchema,
  'quotations:list': quotationQuerySchema.partial(),
  'quotations:get': z.object({ id: z.string().uuid() }),
  'quotations:cancel': cancelQuotationSchema,
  'quotations:document': z.object({ id: z.string().uuid() }),
  'quotations:print': z.object({
    id: z.string().uuid(),
    printerName: z.string().max(200).nullable().optional(),
  }),
  'quotations:exportPdf': z.object({ id: z.string().uuid() }),

  'labels:preview': labelRequestSchema,
  'labels:exportPdf': labelRequestSchema,
  'labels:print': labelRequestSchema.extend({
    printerName: z.string().max(200).nullable().optional(),
  }),

  'counter:account': z.object({ customerId: z.string().uuid() }),
  'counter:receipts': z.object({ customerId: z.string().uuid() }),
  'counter:receive': customerReceiptSchema,
  'shift:current': z.void(),
  'shift:recent': z.void(),
  'shift:open': openShiftSchema,
  'shift:close': closeShiftSchema,

  'batches:list': batchQuerySchema.partial(),
  'batches:save': batchInputSchema,

  'loyalty:cards': z.void(),
  'loyalty:forCustomer': z.object({ customerId: z.string().uuid() }),
  'loyalty:atTill': z.object({
    customerId: z.string().uuid().nullable(),
    billPaise: z.number().int().min(0),
  }),
  'loyalty:entries': z.object({ cardId: z.string().uuid() }),
  'loyalty:issue': issueCardSchema,
  'loyalty:update': updateCardSchema,
  'loyalty:adjust': adjustPointsSchema,

  'ledger:accounts': z.void(),
  'ledger:trialBalance': z.object({
    fromIso: z.iso.datetime(),
    toIso: z.iso.datetime(),
  }),
  'ledger:statement': ledgerQuerySchema,
  'ledger:partyStatement': partyStatementSchema,
  'ledger:openingBalances': openingBalanceSchema,
  'ledger:createAccount': accountInputSchema,
  'ledger:journal': journalSchema,

  'backup:run': backupRunSchema,
  'backup:list': z.void(),
  'backup:inspect': z.object({ path: z.string().min(1).max(1000) }),
  'backup:restore': restoreSchema,

  'audit:list': z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(10).max(200).default(50),
  }),

  'whatsapp:draft': whatsappTargetSchema,
  'whatsapp:send': whatsappTargetSchema.extend({
    number: z.string().trim().min(6).max(20),
    message: z.string().trim().min(1).max(3000),
  }),
  'whatsapp:reveal': z.object({ path: z.string().min(1).max(1000) }),

  'print:listPrinters': z.void(),
  'print:previewHtml': z.object({
    saleId: z.string().uuid(),
    paperSize: z.enum(['58mm', '80mm', 'a4']).optional(),
    isReprint: z.boolean().optional(),
  }),
  'print:receipt': z.object({
    saleId: z.string().uuid(),
    paperSize: z.enum(['58mm', '80mm', 'a4']).optional(),
    printerName: z.string().max(200).nullable().optional(),
    silent: z.boolean().optional(),
    isReprint: z.boolean().optional(),
  }),
  'print:exportPdf': z.object({
    saleId: z.string().uuid(),
    paperSize: z.enum(['58mm', '80mm', 'a4']).optional(),
    isReprint: z.boolean().optional(),
  }),
  'print:testPage': z.object({
    printerName: z.string().max(200).nullable().optional(),
    silent: z.boolean().optional(),
  }),
} as const;

export type IpcChannel = keyof typeof ipcContract;

/** Inferred request type for a channel. */
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof ipcContract)[C]>;

// ─── Response types ──────────────────────────────────────────────────────────

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
  userDataPath: string;
  isPackaged: boolean;
}

export interface DbStatus {
  connected: boolean;
  path: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
}

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

export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

/**
 * What the shop sees before it sends: the number as WhatsApp needs it, the
 * message it can edit, and — when the number cannot be used — the reason, so
 * it can be corrected on the customer rather than typed over each time.
 */
export interface WhatsappDraft {
  kind: 'sale' | 'quotation' | 'purchaseOrder' | 'statement';
  /** The invoice, quotation or order number; the customer's name on a statement. */
  documentNumber: string;
  /** Who it is going to, as the document names them. */
  toName: string | null;
  /** Digits with the country code, or null when there is nothing usable. */
  number: string | null;
  /** What the shop has on file, so it can see what was wrong with it. */
  rawNumber: string | null;
  numberProblem: string | null;
  message: string;
  amountPaise: number;
}

/** Where the two files landed, and whether the hand-off worked. */
export interface WhatsappSend {
  folder: string;
  imagePath: string;
  pdfPath: string;
  link: string;
  imageCopied: boolean;
  opened: boolean;
  revealed: boolean;
}

export interface PrintOutcome {
  printed: boolean;
  /** Why it did not print — including an operator cancelling the dialog. */
  reason: string | null;
}

export interface PickedCsv {
  /** File contents, or null when the dialog was cancelled. */
  content: string | null;
  fileName: string | null;
}

export interface SavedFile {
  saved: boolean;
  path: string | null;
}

export interface PickedPath {
  /** Null when the dialog was cancelled. */
  path: string | null;
}

export interface AuditEntryView {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  operatorName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PickedLogo {
  /** Path relative to userData, or null when the dialog was cancelled. */
  path: string | null;
  /** data: URI for preview, so the renderer never reads from disk. */
  dataUrl: string | null;
}

export interface IpcResponseMap {
  'app:getInfo': AppInfo;
  'app:getDbStatus': DbStatus;
  'setup:getState': SetupState;
  'setup:complete': SetupResult;
  'settings:get': AppSettings | null;
  'settings:update': AppSettings;
  'settings:logo': { dataUrl: string | null };
  'settings:templatePreview': { html: string };
  'dialog:pickLogo': PickedLogo;
  'dialog:openCsv': PickedCsv;
  'dialog:saveCsv': SavedFile;
  'catalogue:listUnits': Unit[];
  'catalogue:listCategories': Category[];
  'catalogue:createCategory': Category[];
  'catalogue:renameCategory': Category[];
  'catalogue:removeCategory': { deleted: boolean; categories: Category[] };
  'products:search': ProductPage;
  'products:get': Product | null;
  'products:create': Product;
  'products:update': Product;
  'products:setActive': Product;
  'products:remove': { deleted: boolean };
  'products:adjustStock': Product;
  'products:exportCsv': string;
  'products:importCsv': CsvImportResult;
  'products:csvTemplate': string;
  'customers:search': Customer[];
  'customers:walkIn': Customer | null;
  'customers:create': Customer;
  'customers:list': CustomerPage;
  'customers:get': Customer | null;
  'customers:update': Customer;
  'customers:setActive': Customer;
  'sales:preview': Bill;
  'sales:create': SaleReceipt;
  'sales:getReceipt': SaleReceipt;
  'sales:search': SalePage;
  'sales:void': SaleReceipt;
  'returns:getSale': ReturnableSale;
  'returns:create': ReturnReceipt;
  'returns:get': ReturnReceipt;
  'inventory:movements': MovementPage;
  'inventory:lowStock': LowStockItem[];
  'reports:run': ReportTable;
  'dashboard:summary': DashboardSummary;
  'suppliers:list': SupplierPage;
  'suppliers:get': Supplier | null;
  'suppliers:create': Supplier;
  'suppliers:update': Supplier;
  'suppliers:setActive': Supplier;
  'suppliers:payments': SupplierPayment[];
  'purchases:create': PurchaseReceipt;
  'purchases:search': PurchasePage;
  'purchases:get': PurchaseReceipt;
  'purchases:cancel': PurchaseReceipt;
  'purchases:createReturn': PurchaseReturnReceipt;
  'purchases:getReturn': PurchaseReturnReceipt;
  'purchases:payment': { id: string; outstandingPaise: number };
  'auth:session': SessionState;
  'auth:login': SessionState;
  'auth:logout': SessionState;
  'auth:lock': SessionState;
  'auth:changePassword': SessionState;

  'users:list': UserSummary[];
  'users:create': UserSummary;
  'users:update': UserSummary;
  'users:setActive': UserSummary;
  'users:resetPassword': UserSummary;

  'purchaseOrders:create': PurchaseOrder;
  'purchaseOrders:list': PurchaseOrderPage;
  'purchaseOrders:get': PurchaseOrder;
  'purchaseOrders:cancel': PurchaseOrder;
  'purchaseOrders:document': { html: string };
  'purchaseOrders:print': PrintOutcome;
  'purchaseOrders:exportPdf': SavedFile;

  'quotations:create': Quotation;
  'quotations:list': QuotationPage;
  'quotations:get': Quotation;
  'quotations:cancel': Quotation;
  'quotations:document': { html: string };
  'quotations:print': PrintOutcome;
  'quotations:exportPdf': SavedFile;

  'labels:preview': { html: string };
  'labels:exportPdf': SavedFile;
  'labels:print': PrintOutcome;

  'counter:account': CustomerAccount;
  'counter:receipts': CustomerReceipt[];
  'counter:receive': CustomerAccount;
  'shift:current': Shift | null;
  'shift:recent': Shift[];
  'shift:open': Shift;
  'shift:close': Shift;

  'batches:list': Batch[];
  'batches:save': Batch;

  'loyalty:cards': LoyaltyCard[];
  'loyalty:forCustomer': LoyaltyCard | null;
  'loyalty:atTill': LoyaltyAtTill;
  'loyalty:entries': LoyaltyEntry[];
  'loyalty:issue': LoyaltyCard;
  'loyalty:update': LoyaltyCard;
  'loyalty:adjust': LoyaltyCard;

  'ledger:accounts': Account[];
  'ledger:trialBalance': AccountBalance[];
  'ledger:statement': LedgerStatement;
  'ledger:partyStatement': PartyStatement;
  'ledger:openingBalances': { voucherId: string };
  'ledger:createAccount': Account;
  'ledger:journal': { voucherId: string };
  'backup:run': BackupResult;
  'backup:list': BackupFile[];
  'backup:inspect': BackupInspection;
  'backup:restore': RestoreResult;
  'audit:list': AuditPage;
  'dialog:pickBackupDirectory': PickedPath;
  'dialog:pickBackupFile': PickedPath;
  'whatsapp:draft': WhatsappDraft;
  'whatsapp:send': WhatsappSend;
  'whatsapp:reveal': { revealed: boolean };

  'print:listPrinters': PrinterInfo[];
  'print:previewHtml': { html: string; paperSize: PaperSize };
  'print:receipt': PrintOutcome;
  'print:exportPdf': SavedFile;
  'print:testPage': PrintOutcome;
}

export type IpcResponse<C extends IpcChannel> = IpcResponseMap[C];

/**
 * Uniform envelope. Handlers never throw across the bridge — a failure comes
 * back as ok:false so the renderer always has a value to branch on.
 */
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export const isChannel = (value: unknown): value is IpcChannel =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ipcContract, value);
