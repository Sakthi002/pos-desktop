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
  /**
   * Whether the shop charges GST at all. A shop below the registration
   * threshold bills without it: nothing is charged, nothing is printed, and
   * the tax on what it buys is part of the cost rather than a credit it could
   * claim. Products keep their rates, so registering later needs one tick.
   */
  registered: z.boolean().default(true),
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

/**
 * How a printed bill looks.
 *
 * The layout of a tax invoice is fixed by what it has to show, so what differs
 * between shops is the dress: which of a few tested designs, in which colour,
 * with which optional columns, and what the shop wants printed at the foot of
 * it. Nothing here can leave out anything the law requires.
 */
export const INVOICE_THEMES = ['classic', 'modern', 'compact', 'bordered'] as const;

export const templateSchema = z.object({
  theme: z.enum(INVOICE_THEMES).default('classic'),
  /** Used for rules, headings and the total on themes that take a colour. */
  accent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Give a colour as #RRGGBB')
    .default('#4F46E5'),
  showLogo: z.boolean().default(true),
  showHsn: z.boolean().default(true),
  showDiscount: z.boolean().default(true),
  showSignature: z.boolean().default(true),
  /** Printed under the signature line; the shop's name when left empty. */
  signatureLabel: optionalText,
  /** Terms and conditions, printed at the foot of an A4 bill. */
  terms: z.string().trim().max(500).optional(),
  /** Bank account or UPI line, for customers who pay later. */
  bankDetails: z.string().trim().max(300).optional(),
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

export const backupSchema = z.object({
  /**
   * Where backups are written. Null until the shop chooses a folder — the
   * app never picks one silently, because a backup beside the database is no
   * protection against losing the disk.
   */
  directory: z
    .union([z.string().max(500), z.null()])
    .optional()
    .transform((v) => v ?? null),
  autoEnabled: z.boolean().default(false),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  /** Older backups beyond this count are pruned after a successful run. */
  keepCount: z.number().int().min(1).max(100).default(10),
  /** Set by the scheduler, so a missed day is caught at the next start. */
  lastRunAt: z
    .union([z.string().max(40), z.null()])
    .optional()
    .transform((v) => v ?? null),
});

export const securitySchema = z.object({
  /**
   * Off until the shop sets an owner password. With it off there is one
   * unnamed operator and no login, which is how a single-handed shop wants it.
   */
  requireLogin: z.boolean().default(false),
  /** Minutes of no use before the till locks itself. 0 turns the timer off. */
  idleLockMinutes: z.number().int().min(0).max(240).default(10),
  /** A void or a return above this value needs a manager to approve it. */
  approvalRequired: z.boolean().default(false),
  approvalAbovePaise: z.number().int().min(0).default(100000),
});

export const loyaltySchema = z.object({
  /** Off by default: a shop that does not run points should never see them. */
  enabled: z.boolean().default(false),
  /** Points earned per ₹100 of the bill, net of discounts and before tax. */
  pointsPerHundred: z.number().int().min(0).max(1000).default(1),
  /** What one point is worth when it comes back. */
  paisePerPoint: z.number().int().min(1).max(10000).default(100),
  /** Nobody wants to redeem three points; this is the floor. */
  minimumRedeemPoints: z.number().int().min(0).max(100000).default(50),
  /** Most of a bill that points may pay for, as a percentage. */
  maxRedeemPercent: z.number().int().min(1).max(100).default(50),
  /** Months a new card runs for. Null never expires. */
  cardExpiryMonths: z
    .union([z.number().int().min(1).max(120), z.null()])
    .optional()
    .transform((v) => v ?? null),
  /** Printed on the receipt under the totals. */
  showOnReceipt: z.boolean().default(true),
});

export const appSettingsSchema = z.object({
  shop: shopSchema,
  locale: localeSchema,
  invoice: invoiceSchema,
  tax: taxSchema,
  receipt: receiptSchema,
  template: templateSchema,
  payment: paymentSchema,
  inventory: inventorySchema,
  backup: backupSchema,
  security: securitySchema,
  loyalty: loyaltySchema,
});

export type ShopSettings = z.infer<typeof shopSchema>;
export type TemplateSettings = z.infer<typeof templateSchema>;
export type InvoiceTheme = (typeof INVOICE_THEMES)[number];
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type SettingsSection = keyof AppSettings;

/** A partial update: any subset of sections, any subset of their fields. */
export const settingsPatchSchema = z.object({
  shop: shopSchema.partial().optional(),
  locale: localeSchema.partial().optional(),
  invoice: invoiceSchema.partial().optional(),
  tax: taxSchema.partial().optional(),
  receipt: receiptSchema.partial().optional(),
  template: templateSchema.partial().optional(),
  payment: paymentSchema.partial().optional(),
  inventory: inventorySchema.partial().optional(),
  backup: backupSchema.partial().optional(),
  security: securitySchema.partial().optional(),
  loyalty: loyaltySchema.partial().optional(),
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
    template: {},
    payment: {},
    inventory: {},
    backup: {},
    security: {},
    loyalty: {},
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
