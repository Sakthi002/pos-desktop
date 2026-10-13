import { z } from 'zod';

/**
 * Loyalty, as the shop sets it and the till uses it.
 *
 * Two rates, kept apart on purpose: what a rupee earns, and what a point is
 * worth when it comes back. Shops change the first far more often than the
 * second, and a card keeps the earning rate it was issued with.
 */

export const LOYALTY_TIERS = ['silver', 'gold', 'platinum'] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export const TIER_LABELS: Record<LoyaltyTier, string> = {
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export const issueCardSchema = z.object({
  customerId: z.string().uuid(),
  tier: z.enum(LOYALTY_TIERS).default('silver'),
  /** Blank asks the shop's numbering to supply one. */
  cardNumber: z.string().trim().max(30).optional(),
  /** Overrides the rate from settings; the card keeps whatever it is issued with. */
  pointsPerHundred: z.number().int().min(0).max(1000).optional(),
  /** Months from today. Null never expires. */
  expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
});

export const updateCardSchema = z.object({
  id: z.string().uuid(),
  tier: z.enum(LOYALTY_TIERS),
  pointsPerHundred: z.number().int().min(0).max(1000),
  expiresAt: z.union([z.iso.datetime(), z.null()]),
  isActive: z.boolean(),
});

export const adjustPointsSchema = z.object({
  customerId: z.string().uuid(),
  /** Signed: a correction can go either way. */
  points: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter a number of points'),
  reason: z.string().trim().min(3, 'Say why').max(200),
});

export type IssueCardInput = z.infer<typeof issueCardSchema>;
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;

export interface LoyaltyCard {
  id: string;
  customerId: string;
  customerName: string;
  cardNumber: string;
  tier: LoyaltyTier;
  pointsPerHundred: number;
  issuedAt: string;
  expiresAt: string | null;
  isActive: boolean;
  /** Summed from the transactions, every time it is asked for. */
  balancePoints: number;
  /** What that balance is worth today, at the shop's current redemption rate. */
  balancePaise: number;
  /** False when the card has lapsed: it can neither earn nor be spent. */
  isUsable: boolean;
}

export interface LoyaltyEntry {
  id: string;
  kind: 'earn' | 'redeem' | 'reverse' | 'adjust';
  points: number;
  valuePaise: number;
  narration: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

/** What the till needs to show, and to cap a redemption by. */
export interface LoyaltyAtTill {
  card: LoyaltyCard | null;
  /** Most that may be spent on this bill, in points and in money. */
  maxRedeemablePoints: number;
  maxRedeemablePaise: number;
  /** Why nothing can be redeemed, when nothing can. */
  blockedReason: string | null;
}

/** Points a bill earns. Rounded down: a shop never owes a fraction of a point. */
export function pointsFor(netPaise: number, pointsPerHundred: number): number {
  if (netPaise <= 0 || pointsPerHundred <= 0) return 0;
  return Math.floor((netPaise / 10000) * pointsPerHundred);
}

/** What a number of points is worth in money, at a given rate. */
export function valueOf(points: number, paisePerPoint: number): number {
  return Math.max(0, points) * paisePerPoint;
}
