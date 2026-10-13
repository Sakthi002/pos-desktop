/**
 * Audit trail.
 *
 * Append-only by contract: this repository can insert and read, and offers no
 * update or delete. Anything that changes a committed record — a void today,
 * a return or a restore later — leaves a row here saying who did it and why.
 */
import type { Database } from 'better-sqlite3';
import { Repository, newId, now } from './base';

export interface AuditEntry {
  entityType: string;
  entityId: string | null;
  action: string;
  operatorId: string | null;
  /** Serialised to JSON; keep it to facts about the change. */
  details?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  operatorId: string | null;
  operatorName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditDbRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  operator_id: string | null;
  details: string | null;
  created_at: string;
}

const toAuditRow = (row: AuditDbRow & { operator_name?: string | null }): AuditRow => ({
  id: row.id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  action: row.action,
  operatorId: row.operator_id,
  operatorName: row.operator_name ?? null,
  details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
  createdAt: row.created_at,
});

export class AuditRepository extends Repository {
  constructor(db: Database) {
    super(db);
  }

  record(entry: AuditEntry, at: string = now()): string {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, entity_type, entity_id, action, operator_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.entityType,
        entry.entityId,
        entry.action,
        entry.operatorId,
        entry.details ? JSON.stringify(entry.details) : null,
        at,
      );
    return id;
  }

  /** Newest first, across every entity: the trail as a reader sees it. */
  list(limit: number, offset: number): AuditRow[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, o.name AS operator_name
           FROM audit_logs a
           LEFT JOIN operators o ON o.id = a.operator_id
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as (AuditDbRow & { operator_name: string | null })[];
    return rows.map(toAuditRow);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n;
  }

  /** Newest first. Used by the invoice detail to show why a sale was voided. */
  listFor(entityType: string, entityId: string): AuditRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_logs
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY created_at DESC, id DESC`,
      )
      .all(entityType, entityId) as AuditDbRow[];
    return rows.map(toAuditRow);
  }
}
