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
