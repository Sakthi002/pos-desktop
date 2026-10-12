/**
 * Repository foundations.
 *
 * Repositories are the only place SQL is written, and every statement is
 * parameterised. Nothing above this layer composes SQL strings.
 */
import type { Database, Transaction } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/** ISO-8601 UTC, the single timestamp format used across the schema. */
export const now = (): string => new Date().toISOString();

/**
 * SQLite has no boolean type; the schema uses INTEGER 0/1 with CHECK
 * constraints. These keep the conversion in one place.
 */
export const toDbBool = (value: boolean): 0 | 1 => (value ? 1 : 0);
export const fromDbBool = (value: number): boolean => value === 1;

/**
 * Runs `work` in a transaction. better-sqlite3 rolls back automatically if the
 * callback throws, so a partial write cannot survive an error.
 *
 * Transactions must not contain `await`: better-sqlite3 is synchronous, and an
 * await would let other work interleave inside the transaction.
 */
export function inTransaction<T>(db: Database, work: () => T): T {
  const wrapped: Transaction<() => T> = db.transaction(work);
  return wrapped();
}

export abstract class Repository {
  constructor(protected readonly db: Database) {}
}
