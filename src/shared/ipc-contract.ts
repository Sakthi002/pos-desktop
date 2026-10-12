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
import { appSettingsSchema, settingsPatchSchema, type AppSettings } from './settings';
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
import { saleInputSchema, billPreviewSchema, type SaleReceipt } from './sale';
import { customerInputSchema, type Customer } from './customer';
import type { Bill } from './billing';
import type { PaperSize } from './receipt';

/** Payload schemas, keyed by channel name. */
export const ipcContract = {
  'app:getInfo': z.void(),
  'app:getDbStatus': z.void(),

  'setup:getState': z.void(),
  'setup:complete': appSettingsSchema,

  'settings:get': z.void(),
  'settings:update': settingsPatchSchema,

  'dialog:pickLogo': z.void(),
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

  'sales:preview': billPreviewSchema,
  'sales:create': saleInputSchema,
  'sales:getReceipt': z.object({ id: z.string().uuid() }),

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
  'sales:preview': Bill;
  'sales:create': SaleReceipt;
  'sales:getReceipt': SaleReceipt;
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
