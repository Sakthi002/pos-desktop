/**
 * Loyalty, as storage.
 *
 * The balance is a SUM over signed transactions and is never written down.
 * Transactions cannot be updated or deleted — the triggers refuse — so this
 * repository offers inserts and reads and nothing else.
 */
import type { Database } from 'better-sqlite3';
import type { LoyaltyEntry, LoyaltyTier } from '@shared/loyalty';
import { Repository, newId, now, toDbBool, fromDbBool } from './base';

export interface CardRow {
  id: string;
  customer_id: string;
  customer_name: string;
  card_number: string;
  tier: string;
  points_per_hundred: number;
  issued_at: string;
  expires_at: string | null;
  is_active: number;
}

export class LoyaltyRepository extends Repository {
  constructor(
    db: Database,
    private readonly companyId: string,
  ) {
    super(db);
  }

  private readonly selectCard = `
    SELECT c.*, cu.name AS customer_name
      FROM loyalty_cards c
      JOIN customers cu ON cu.id = c.customer_id`;

  cardForCustomer(customerId: string): CardRow | null {
    const row = this.db.prepare(`${this.selectCard} WHERE c.customer_id = ?`).get(customerId) as
      CardRow | undefined;
    return row ?? null;
  }

  cardById(id: string): CardRow | null {
    const row = this.db.prepare(`${this.selectCard} WHERE c.id = ?`).get(id) as CardRow | undefined;
    return row ?? null;
  }

  cardByNumber(cardNumber: string): CardRow | null {
    const row = this.db
      .prepare(`${this.selectCard} WHERE c.company_id = ? AND c.card_number = ?`)
      .get(this.companyId, cardNumber) as CardRow | undefined;
    return row ?? null;
  }

  listCards(): CardRow[] {
    return this.db
      .prepare(`${this.selectCard} WHERE c.company_id = ? ORDER BY c.is_active DESC, cu.name`)
      .all(this.companyId) as CardRow[];
  }

  /** The next number in the shop's own card series, as plain digits. */
  nextCardNumber(): string {
    const row = this.db
      .prepare(
        `SELECT card_number FROM loyalty_cards
          WHERE company_id = ? AND card_number GLOB '[0-9]*'
          ORDER BY CAST(card_number AS INTEGER) DESC LIMIT 1`,
      )
      .get(this.companyId) as { card_number: string } | undefined;

    const next = row ? Number(row.card_number) + 1 : 1001;
    return String(next);
  }

  insertCard(input: {
    customerId: string;
    cardNumber: string;
    tier: LoyaltyTier;
    pointsPerHundred: number;
    expiresAt: string | null;
  }): string {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO loyalty_cards (id, company_id, customer_id, card_number, tier,
           points_per_hundred, issued_at, expires_at, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        this.companyId,
        input.customerId,
        input.cardNumber,
        input.tier,
        input.pointsPerHundred,
        t,
        input.expiresAt,
        t,
        t,
      );
    return id;
  }

  updateCard(input: {
    id: string;
    tier: LoyaltyTier;
    pointsPerHundred: number;
    expiresAt: string | null;
    isActive: boolean;
  }): void {
    this.db
      .prepare(
        `UPDATE loyalty_cards
            SET tier = ?, points_per_hundred = ?, expires_at = ?, is_active = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.tier,
        input.pointsPerHundred,
        input.expiresAt,
        toDbBool(input.isActive),
        now(),
        input.id,
      );
  }

  balance(cardId: string): number {
    return (
      (
        this.db
          .prepare(
            'SELECT COALESCE(SUM(points), 0) AS n FROM loyalty_transactions WHERE card_id = ?',
          )
          .get(cardId) as { n: number }
      ).n ?? 0
    );
  }

  insertTransaction(input: {
    /** Supplied when the caller needs the id before the row exists. */
    id?: string;
    cardId: string;
    customerId: string;
    kind: 'earn' | 'redeem' | 'reverse' | 'adjust';
    points: number;
    valuePaise: number;
    referenceType: 'sale' | 'sale_return' | 'manual' | null;
    referenceId: string | null;
    narration: string | null;
    operatorId: string | null;
  }): string {
    const id = input.id ?? newId();
    this.db
      .prepare(
        `INSERT INTO loyalty_transactions (id, company_id, card_id, customer_id, kind, points,
           value_paise, reference_type, reference_id, narration, operator_id, created_at)
         VALUES (@id, @companyId, @cardId, @customerId, @kind, @points, @valuePaise,
           @referenceType, @referenceId, @narration, @operatorId, @createdAt)`,
      )
      .run({ ...input, id, companyId: this.companyId, createdAt: now() });
    return id;
  }

  /** True when this document has already moved points this way. */
  hasTransaction(referenceType: string, referenceId: string, kind: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM loyalty_transactions
          WHERE reference_type = ? AND reference_id = ? AND kind = ? LIMIT 1`,
      )
      .get(referenceType, referenceId, kind) as { found: number } | undefined;
    return row !== undefined;
  }

  entries(cardId: string, limit: number): LoyaltyEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, points, value_paise, narration, reference_type, reference_id, created_at
           FROM loyalty_transactions
          WHERE card_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(cardId, limit) as {
      id: string;
      kind: string;
      points: number;
      value_paise: number;
      narration: string | null;
      reference_type: string | null;
      reference_id: string | null;
      created_at: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as LoyaltyEntry['kind'],
      points: row.points,
      valuePaise: row.value_paise,
      narration: row.narration,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      createdAt: row.created_at,
    }));
  }

  /** Points outstanding across every card: what the shop owes in points. */
  outstandingPoints(): number {
    return (
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(t.points), 0) AS n
               FROM loyalty_transactions t WHERE t.company_id = ?`,
          )
          .get(this.companyId) as { n: number }
      ).n ?? 0
    );
  }

  isActive = (row: CardRow): boolean => fromDbBool(row.is_active);
}
