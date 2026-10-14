/**
 * The opening screen.
 *
 * What a shopkeeper wants on walking in: what today has taken, what is about
 * to run out, and the last few bills. Everything here is derived from the same
 * queries the reports use, so the dashboard cannot quietly disagree with them.
 */
import { z } from 'zod';
import type { LowStockItem } from './inventory';
import type { PaymentMethod, SaleSummary } from './sale';

export const dashboardQuerySchema = z.object({
  /** The shop's local day, converted by the renderer that knows the timezone. */
  fromIso: z.iso.datetime(),
  toIso: z.iso.datetime(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface DashboardTakings {
  invoices: number;
  /** Sum of completed invoices in the range. */
  totalPaise: number;
  /** Credit notes raised in the range. */
  returnedPaise: number;
  /** Takings less credit notes. */
  netPaise: number;
}

export interface DashboardMethod {
  method: PaymentMethod;
  collectedPaise: number;
  refundedPaise: number;
}

export interface DashboardSummary {
  today: DashboardTakings;
  /** The same figures for the seven days ending today, for context. */
  week: DashboardTakings;
  /**
   * The two spans before those, so a figure can be shown against the one it
   * should be read against. A shop comparing today with last week's total
   * would learn nothing; today against yesterday it can act on.
   */
  yesterday: DashboardTakings;
  previousWeek: DashboardTakings;
  methods: DashboardMethod[];
  lowStock: LowStockItem[];
  recentSales: SaleSummary[];
  /** Batches on the shelf that expire within a month, or already have. */
  expiring: { batches: number; valuePaise: number };
}
