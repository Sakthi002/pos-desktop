/**
 * Points.
 *
 * Earning and spending are both transactions against a card, and the balance
 * is their sum — there is no stored total to go wrong. Each is written once per
 * document: a unique index refuses a second earning for the same sale, so a
 * retry cannot pay a customer twice.
 *
 * Earning happens on the bill net of discounts and before tax, because tax is
 * not the shop's money and a shop should not pay points on it.
 *
 * Nothing here opens a transaction of its own: the sale's transaction is the
 * one that matters, and points move inside it or not at all.
 */
import type { Database } from 'better-sqlite3';
import {
  adjustPointsSchema,
  issueCardSchema,
  pointsFor,
  updateCardSchema,
  valueOf,
  type LoyaltyAtTill,
  type LoyaltyCard,
  type LoyaltyEntry,
  type LoyaltyTier,
} from '@shared/loyalty';
import type { AppSettings } from '@shared/settings';
import { LoyaltyRepository, type CardRow } from '../db/repositories/loyalty';
import { AuditRepository } from '../db/repositories/audit';
import { inTransaction, newId } from '../db/repositories/base';
import { LedgerService } from './ledger-service';
import { SettingsService } from './settings-service';
import { loadBranchContext, type BranchContext } from './branch-context';

export class LoyaltyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LoyaltyError';
  }
}

export class LoyaltyService {
  private readonly ctx: BranchContext;
  private readonly settings: AppSettings;
  private readonly repo: LoyaltyRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    const ctx = loadBranchContext(db);
    if (!ctx) throw new LoyaltyError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.ctx = ctx;

    const settings = new SettingsService(db).get();
    if (!settings) throw new LoyaltyError('SETUP_INCOMPLETE', 'Complete setup first.');
    this.settings = settings;

    this.repo = new LoyaltyRepository(db, ctx.companyId);
    this.audit = new AuditRepository(db);
  }

  get enabled(): boolean {
    return this.settings.loyalty.enabled;
  }

  private hasLapsed(row: CardRow): boolean {
    return row.expires_at !== null && row.expires_at < new Date().toISOString();
  }

  private toCard(row: CardRow): LoyaltyCard {
    const balance = this.repo.balance(row.id);
    return {
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      cardNumber: row.card_number,
      tier: row.tier as LoyaltyTier,
      pointsPerHundred: row.points_per_hundred,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      isActive: row.is_active === 1,
      balancePoints: balance,
      balancePaise: valueOf(balance, this.settings.loyalty.paisePerPoint),
      isUsable: row.is_active === 1 && !this.hasLapsed(row),
    };
  }

  // ─── Cards ────────────────────────────────────────────────────────────────

  cards(): LoyaltyCard[] {
    return this.repo.listCards().map((row) => this.toCard(row));
  }

  cardFor(customerId: string): LoyaltyCard | null {
    const row = this.repo.cardForCustomer(customerId);
    return row ? this.toCard(row) : null;
  }

  entries(cardId: string, limit = 100): LoyaltyEntry[] {
    return this.repo.entries(cardId, limit);
  }

  issueCard(input: unknown): LoyaltyCard {
    const parsed = issueCardSchema.parse(input);
    if (this.repo.cardForCustomer(parsed.customerId)) {
      throw new LoyaltyError('ALREADY_HAS_CARD', 'This customer already has a card.');
    }

    const walkIn = this.db
      .prepare('SELECT is_walk_in FROM customers WHERE id = ?')
      .get(parsed.customerId) as { is_walk_in: number } | undefined;
    if (!walkIn) throw new LoyaltyError('NOT_FOUND', 'That customer does not exist.');
    if (walkIn.is_walk_in === 1) {
      // Points belong to a person the shop can recognise again.
      throw new LoyaltyError('WALK_IN', 'Walk-in customers cannot hold a card.');
    }

    const number = parsed.cardNumber?.trim() || this.repo.nextCardNumber();
    if (this.repo.cardByNumber(number)) {
      throw new LoyaltyError('NUMBER_TAKEN', 'That card number is already in use.');
    }

    const months =
      parsed.expiryMonths === undefined
        ? this.settings.loyalty.cardExpiryMonths
        : parsed.expiryMonths;
    const expiresAt = months === null ? null : this.monthsFromNow(months);

    const id = inTransaction(this.db, () => {
      const cardId = this.repo.insertCard({
        customerId: parsed.customerId,
        cardNumber: number,
        tier: parsed.tier,
        pointsPerHundred: parsed.pointsPerHundred ?? this.settings.loyalty.pointsPerHundred,
        expiresAt,
      });
      this.audit.record({
        entityType: 'loyalty_card',
        entityId: cardId,
        action: 'card.issued',
        operatorId: this.ctx.operatorId,
        details: { cardNumber: number, tier: parsed.tier },
      });
      return cardId;
    });

    return this.toCard(this.repo.cardById(id) as CardRow);
  }

  updateCard(input: unknown): LoyaltyCard {
    const parsed = updateCardSchema.parse(input);
    const row = this.repo.cardById(parsed.id);
    if (!row) throw new LoyaltyError('NOT_FOUND', 'That card does not exist.');

    inTransaction(this.db, () => {
      this.repo.updateCard({
        id: parsed.id,
        tier: parsed.tier,
        pointsPerHundred: parsed.pointsPerHundred,
        expiresAt: parsed.expiresAt,
        isActive: parsed.isActive,
      });
      this.audit.record({
        entityType: 'loyalty_card',
        entityId: parsed.id,
        action: 'card.updated',
        operatorId: this.ctx.operatorId,
        details: { tier: parsed.tier, isActive: parsed.isActive },
      });
    });

    return this.toCard(this.repo.cardById(parsed.id) as CardRow);
  }

  /** A correction, in either direction, with a reason that stays on the card. */
  adjust(input: unknown): LoyaltyCard {
    const parsed = adjustPointsSchema.parse(input);
    const row = this.repo.cardForCustomer(parsed.customerId);
    if (!row) throw new LoyaltyError('NO_CARD', 'This customer has no card.');

    const balance = this.repo.balance(row.id);
    if (balance + parsed.points < 0) {
      throw new LoyaltyError('BELOW_ZERO', 'That would take the balance below zero.');
    }

    // The entry references itself, so the voucher that accounts for it has
    // something to point at: a correction has no document of its own.
    const transactionId = newId();

    inTransaction(this.db, () => {
      this.repo.insertTransaction({
        id: transactionId,
        cardId: row.id,
        customerId: row.customer_id,
        kind: 'adjust',
        points: parsed.points,
        valuePaise: 0,
        referenceType: 'manual',
        referenceId: transactionId,
        narration: parsed.reason,
        operatorId: this.ctx.operatorId,
      });
      new LedgerService(this.db).postLoyaltyAdjustment(transactionId);
      this.audit.record({
        entityType: 'loyalty_card',
        entityId: row.id,
        action: 'points.adjusted',
        operatorId: this.ctx.operatorId,
        details: { points: parsed.points, reason: parsed.reason },
      });
    });

    return this.toCard(this.repo.cardById(row.id) as CardRow);
  }

  // ─── At the till ──────────────────────────────────────────────────────────

  /**
   * What the till may offer: the card, and the most that can be spent on a
   * bill of this size. Both caps apply — the balance, and the share of the
   * bill the shop is willing to let points pay for.
   */
  atTill(customerId: string | null, billPaise: number): LoyaltyAtTill {
    const empty: LoyaltyAtTill = {
      card: null,
      maxRedeemablePoints: 0,
      maxRedeemablePaise: 0,
      blockedReason: null,
    };

    if (!this.enabled || !customerId) return empty;

    const row = this.repo.cardForCustomer(customerId);
    if (!row) return empty;

    const card = this.toCard(row);
    const rules = this.settings.loyalty;

    const blocked = (reason: string): LoyaltyAtTill => ({ ...empty, card, blockedReason: reason });

    if (!card.isActive) return blocked('This card is inactive.');
    if (this.hasLapsed(row)) return blocked('This card has expired.');
    if (card.balancePoints < rules.minimumRedeemPoints) {
      return blocked(`At least ${rules.minimumRedeemPoints} points are needed to redeem.`);
    }

    const shareOfBill = Math.floor((billPaise * rules.maxRedeemPercent) / 100);
    const affordable = Math.min(card.balancePaise, shareOfBill);
    const points = Math.floor(affordable / rules.paisePerPoint);

    return {
      card,
      maxRedeemablePoints: points,
      maxRedeemablePaise: points * rules.paisePerPoint,
      blockedReason: points > 0 ? null : 'This bill is too small to use points on.',
    };
  }

  /**
   * Checks a redemption and returns what it is worth, without writing. The
   * till calls this while the bill is still being built, so the discount can
   * be shown before anything is committed.
   */
  priceRedemption(customerId: string | null, billPaise: number, points: number): number {
    if (points <= 0) return 0;

    const offer = this.atTill(customerId, billPaise);
    if (!offer.card) throw new LoyaltyError('NO_CARD', 'This customer has no card.');
    if (offer.blockedReason) throw new LoyaltyError('CANNOT_REDEEM', offer.blockedReason);
    if (points > offer.card.balancePoints) {
      throw new LoyaltyError('NOT_ENOUGH_POINTS', 'That is more than the card holds.');
    }
    if (points > offer.maxRedeemablePoints) {
      throw new LoyaltyError(
        'OVER_CAP',
        `Points may pay for at most ${this.settings.loyalty.maxRedeemPercent}% of a bill.`,
      );
    }

    return points * this.settings.loyalty.paisePerPoint;
  }

  // ─── Driven by documents ──────────────────────────────────────────────────

  /**
   * Called inside a sale's transaction. Writes the spending first, then the
   * earning, and returns what it wrote so the sale can keep its own copy.
   */
  recordForSale(input: {
    saleId: string;
    customerId: string | null;
    netPaise: number;
    redeemPoints: number;
    redeemPaise: number;
  }): { earned: number } {
    if (!this.enabled || !input.customerId) return { earned: 0 };

    const row = this.repo.cardForCustomer(input.customerId);
    if (!row || row.is_active !== 1 || this.hasLapsed(row)) return { earned: 0 };

    if (input.redeemPoints > 0 && !this.repo.hasTransaction('sale', input.saleId, 'redeem')) {
      this.repo.insertTransaction({
        cardId: row.id,
        customerId: row.customer_id,
        kind: 'redeem',
        points: -input.redeemPoints,
        valuePaise: input.redeemPaise,
        referenceType: 'sale',
        referenceId: input.saleId,
        narration: 'Spent on a bill',
        operatorId: this.ctx.operatorId,
      });
    }

    const earned = pointsFor(input.netPaise, row.points_per_hundred);
    if (earned > 0 && !this.repo.hasTransaction('sale', input.saleId, 'earn')) {
      this.repo.insertTransaction({
        cardId: row.id,
        customerId: row.customer_id,
        kind: 'earn',
        points: earned,
        valuePaise: 0,
        referenceType: 'sale',
        referenceId: input.saleId,
        narration: 'Earned on a bill',
        operatorId: this.ctx.operatorId,
      });
    }

    return { earned };
  }

  /**
   * A sale that is voided or returned takes its points back, in proportion to
   * what came back. Spent points are returned to the card: the customer gave
   * up value for goods they no longer have.
   *
   * The balance may go negative if the points were already spent elsewhere,
   * which is the truth and is left visible rather than quietly floored.
   */
  reverseForSale(input: {
    saleId: string;
    referenceType: 'sale' | 'sale_return';
    referenceId: string;
    /** 1 for a whole sale, a fraction of the sale's value for a partial return. */
    proportion: number;
    narration: string;
  }): void {
    if (!this.enabled) return;

    const sale = this.db
      .prepare(
        `SELECT customer_id, loyalty_points_earned, loyalty_points_redeemed
           FROM sales WHERE id = ?`,
      )
      .get(input.saleId) as
      | {
          customer_id: string | null;
          loyalty_points_earned: number;
          loyalty_points_redeemed: number;
        }
      | undefined;

    if (!sale?.customer_id) return;
    const row = this.repo.cardForCustomer(sale.customer_id);
    if (!row) return;

    if (this.repo.hasTransaction(input.referenceType, input.referenceId, 'reverse')) return;

    const share = Math.min(1, Math.max(0, input.proportion));
    const takeBack = Math.round(sale.loyalty_points_earned * share);
    const giveBack = Math.round(sale.loyalty_points_redeemed * share);
    const net = giveBack - takeBack;
    if (net === 0) return;

    this.repo.insertTransaction({
      cardId: row.id,
      customerId: row.customer_id,
      kind: 'reverse',
      points: net,
      valuePaise: 0,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      narration: input.narration,
      operatorId: this.ctx.operatorId,
    });
  }

  /** Points the shop owes across every card, and what they are worth. */
  liability(): { points: number; paise: number } {
    const points = this.repo.outstandingPoints();
    return { points, paise: valueOf(points, this.settings.loyalty.paisePerPoint) };
  }

  private monthsFromNow(months: number): string {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date.toISOString();
  }
}
