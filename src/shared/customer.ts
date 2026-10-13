import { z } from 'zod';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  stateCode: string | null;
  isWalkIn: boolean;
  isActive: boolean;
}

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[\d +-]{6,20}$/, 'Enter a valid phone number'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === null ? '' : v)),
  email: z
    .union([z.string().trim().max(120), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : v)),
  address: z
    .union([z.string().trim().max(300), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : v)),
  gstin: z
    .union([
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]$/, 'GSTIN must be 15 characters'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === null ? '' : v)),
  /** Drives CGST+SGST versus IGST on this customer's invoices. */
  stateCode: z
    .union([z.string().regex(/^\d{2}$/), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null ? '' : v)),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

export const customerUpdateSchema = customerInputSchema.extend({
  id: z.string().uuid(),
});

export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

export const customerQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export type CustomerQuery = z.infer<typeof customerQuerySchema>;

/** A customer with what they have bought — what a shopkeeper actually wants to see. */
export interface CustomerSummary extends Customer {
  invoices: number;
  totalPaise: number;
  lastPurchaseAt: string | null;
}

export interface CustomerPage {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
}
