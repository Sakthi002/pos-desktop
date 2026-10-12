/**
 * Application settings: schema, defaults and validation.
 *
 * Settings govern how *future* transactions behave. Anything that affects a
 * sale is snapshotted onto that sale, so changing a setting never alters a
 * completed invoice.
 */
import { z } from 'zod';

const optionalText = z.string().trim().max(200).optional();

/** 15 characters: 2 state digits, 10-char PAN, entity digit, 'Z', checksum. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]$/;

export const shopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required').max(120),
  legalName: optionalText,
  businessCategory: z
    .enum(['grocery', 'supermarket', 'textile', 'hardware', 'electronics', 'stationery', 'other'])
    .default('grocery'),
  phone: optionalText,
  email: optionalText,
  address: optionalText,
  city: optionalText,
  stateCode: z
    .string()
    .regex(/^\d{2}$/, 'Select a state')
    .default('33'),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Pincode must be 6 digits')
    .optional()
    .or(z.literal('')),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_PATTERN, 'GSTIN must be 15 characters, e.g. 33AAAAA0000A1Z5')
    .optional()
    .or(z.literal('')),
  logoPath: optionalText,
});

export const localeSchema = z.object({
  currency: z.literal('INR').default('INR'),
  timezone: z.string().default('Asia/Kolkata'),
});

export const invoiceSchema = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9-]+$/, 'Prefix may use letters, numbers and hyphens')
    .default('INV'),
  startNumber: z.number().int().min(1).max(9_999_999).default(1),
  /** India's financial year starts in April. */
  financialYearStartMonth: z.number().int().min(1).max(12).default(4),
});

export const taxSchema = z.object({
  /** Whether entered prices already contain tax. */
  mode: z.enum(['inclusive', 'exclusive']).default('inclusive'),
  /** Round the invoice total to the nearest rupee and show the adjustment. */
  roundTotalToRupee: z.boolean().default(true),
});

export const receiptSchema = z.object({
  paperSize: z.enum(['58mm', '80mm', 'a4']).default('80mm'),
  footerText: optionalText,
  showGstBreakdown: z.boolean().default(true),
  /** OS printer name; null uses the system default and shows the dialog. */
  printerName: z
    .union([z.string().max(200), z.null()])
    .optional()
    .transform((v) => v ?? null),
  /**
   * Skip the print dialog. Off by default: silent printing is not guaranteed
   * on every printer and must be verified per installation.
   */
  silentPrint: z.boolean().default(false),
});

export const paymentSchema = z.object({
  methods: z
    .array(z.enum(['cash', 'upi', 'card', 'bank', 'other']))
    .min(1, 'Enable at least one payment method')
    .default(['cash', 'upi', 'card']),
});

export const inventorySchema = z.object({
  /** Default is to block a sale that would drive stock negative. */
  allowNegativeStock: z.boolean().default(false),
});

export const appSettingsSchema = z.object({
  shop: shopSchema,
  locale: localeSchema,
  invoice: invoiceSchema,
  tax: taxSchema,
  receipt: receiptSchema,
  payment: paymentSchema,
  inventory: inventorySchema,
});

export type ShopSettings = z.infer<typeof shopSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type SettingsSection = keyof AppSettings;

/** A partial update: any subset of sections, any subset of their fields. */
export const settingsPatchSchema = z.object({
  shop: shopSchema.partial().optional(),
  locale: localeSchema.partial().optional(),
  invoice: invoiceSchema.partial().optional(),
  tax: taxSchema.partial().optional(),
  receipt: receiptSchema.partial().optional(),
  payment: paymentSchema.partial().optional(),
  inventory: inventorySchema.partial().optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Defaults for everything except the shop name, which must be supplied. */
export function defaultSettings(shopName: string): AppSettings {
  return appSettingsSchema.parse({
    shop: { name: shopName },
    locale: {},
    invoice: {},
    tax: {},
    receipt: {},
    payment: {},
    inventory: {},
  });
}

/**
 * Starting point for the setup wizard, where the shop name has not been typed
 * yet. Built by hand rather than through `parse`, because the schema rightly
 * rejects an empty name and the wizard must be able to render before one exists.
 */
export function draftSettings(): AppSettings {
  const base = defaultSettings('placeholder');
  return { ...base, shop: { ...base.shop, name: '' } };
}

/**
 * Financial year label for a date, e.g. 2026-27 for any date from
 * 1 April 2026 to 31 March 2027. Used to scope invoice numbering.
 */
export function financialYearOf(date: Date, startMonth = 4): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() + 1 >= startMonth ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export const BUSINESS_CATEGORIES = [
  { value: 'grocery', label: 'Grocery / General store' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'textile', label: 'Textile / Clothing' },
  { value: 'hardware', label: 'Hardware / Electrical' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'other', label: 'Other retail' },
] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};
