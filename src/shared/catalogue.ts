/**
 * Catalogue domain: units, categories and products.
 *
 * Amounts crossing this boundary are paise; quantities are milli. The UI parses
 * operator text into those integers before anything is sent to the main process.
 */
import { z } from 'zod';

// ─── Units ──────────────────────────────────────────────────────────────────

export interface Unit {
  code: string;
  name: string;
  decimalPlaces: number;
  isActive: boolean;
}

// ─── Categories ─────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(80),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

// ─── Products ───────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  hsn: string | null;
  unitCode: string;
  costPaise: number;
  pricePaise: number;
  mrpPaise: number | null;
  taxRateBp: number;
  taxInclusive: boolean;
  trackInventory: boolean;
  reorderLevelMilli: number;
  isActive: boolean;
  /** Derived from the movement ledger, not stored. */
  stockMilli: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Optional free text. Accepts null as well as undefined and '', because a
 * Product read back from the database carries null for an empty field and the
 * edit form sends that product straight back.
 */
const optionalTrimmed = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : v));

export const productInputSchema = z.object({
  sku: optionalTrimmed(50),
  barcode: optionalTrimmed(50),
  name: z.string().trim().min(1, 'Product name is required').max(150),
  description: optionalTrimmed(500),
  categoryId: z.string().uuid().nullable().optional(),
  brand: optionalTrimmed(80),
  hsn: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === null ? '' : v)),
  unitCode: z.string().min(1, 'Choose a unit'),
  costPaise: z.number().int().min(0).default(0),
  pricePaise: z.number().int().min(0, 'Price is required'),
  mrpPaise: z.number().int().min(0).nullable().optional(),
  /** Basis points: 1800 = 18%. GST slabs are 0, 5, 12, 18 and 28. */
  taxRateBp: z.number().int().min(0).max(10000).default(0),
  taxInclusive: z.boolean().default(true),
  /** False for a service line that should never move stock. */
  trackInventory: z.boolean().default(true),
  reorderLevelMilli: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  /** Only honoured on create; afterwards stock moves through adjustments. */
  openingStockMilli: z.number().int().min(0).default(0),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productUpdateSchema = productInputSchema
  .omit({ openingStockMilli: true })
  .extend({ id: z.string().uuid() });

export type ProductUpdate = z.infer<typeof productUpdateSchema>;

// ─── Queries ────────────────────────────────────────────────────────────────

export const productQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['all', 'active', 'inactive', 'low-stock']).default('active'),
  sort: z.enum(['name', 'sku', 'price', 'stock', 'updated']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Stock adjustment ───────────────────────────────────────────────────────

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  /** Signed delta in milli: negative removes stock. */
  deltaMilli: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter a quantity'),
  reason: z.string().trim().min(1, 'A reason is required').max(200),
});

export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;

// ─── CSV import ─────────────────────────────────────────────────────────────

export interface CsvRowError {
  row: number;
  field: string;
  message: string;
}

export interface CsvImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: CsvRowError[];
}

export const csvImportSchema = z.object({
  csv: z.string().min(1, 'The file is empty'),
  /** Update a product when its SKU or barcode already exists. */
  updateExisting: z.boolean().default(false),
});

export type CsvImport = z.infer<typeof csvImportSchema>;

/** GST slabs, in basis points. */
export const TAX_SLABS = [
  { bp: 0, label: 'Exempt / 0%' },
  { bp: 500, label: '5%' },
  { bp: 1200, label: '12%' },
  { bp: 1800, label: '18%' },
  { bp: 2800, label: '28%' },
] as const;
