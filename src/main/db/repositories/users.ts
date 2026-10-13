/**
 * Users, as storage. A user is never deleted — documents point at them for as
 * long as those documents exist, which is forever — so leaving is `is_active`.
 */
import type { Database } from 'better-sqlite3';
import type { UserSummary } from '@shared/auth';
import type { Role } from '@shared/permissions';
import { Repository, newId, now, toDbBool, fromDbBool } from './base';

interface UserRow {
  id: string;
  branch_id: string;
  name: string;
  username: string;
  password_hash: string | null;
  role: string;
  must_change_password: number;
  last_login_at: string | null;
  is_active: number;
  created_at: string;
}

const toSummary = (row: UserRow): UserSummary => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role as Role,
  isActive: fromDbBool(row.is_active),
  hasPassword: row.password_hash !== null,
  mustChangePassword: fromDbBool(row.must_change_password),
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

export class UserRepository extends Repository {
  constructor(db: Database) {
    super(db);
  }

  list(): UserSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM operators ORDER BY is_active DESC, name')
      .all() as UserRow[];
    return rows.map(toSummary);
  }

  byUsername(username: string): UserRow | null {
    const row = this.db
      .prepare('SELECT * FROM operators WHERE username = ?')
      .get(username.toLowerCase()) as UserRow | undefined;
    return row ?? null;
  }

  byId(id: string): UserRow | null {
    const row = this.db.prepare('SELECT * FROM operators WHERE id = ?').get(id) as
      UserRow | undefined;
    return row ?? null;
  }

  create(input: {
    branchId: string;
    name: string;
    username: string;
    role: Role;
    passwordHash: string;
  }): UserSummary {
    const id = newId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO operators (id, branch_id, name, username, password_hash, role,
           must_change_password, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      )
      .run(id, input.branchId, input.name, input.username, input.passwordHash, input.role, t, t);

    return toSummary(this.byId(id) as UserRow);
  }

  update(id: string, name: string, role: Role): void {
    this.db
      .prepare('UPDATE operators SET name = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(name, role, now(), id);
  }

  setActive(id: string, isActive: boolean): void {
    this.db
      .prepare('UPDATE operators SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(toDbBool(isActive), now(), id);
  }

  setPassword(id: string, passwordHash: string, mustChange: boolean): void {
    this.db
      .prepare(
        `UPDATE operators SET password_hash = ?, must_change_password = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(passwordHash, toDbBool(mustChange), now(), id);
  }

  recordLogin(id: string): void {
    this.db.prepare('UPDATE operators SET last_login_at = ? WHERE id = ?').run(now(), id);
  }

  /** How many accounts could still administer the shop if this one went away. */
  otherActiveAdmins(exceptId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM operators
            WHERE role = 'admin' AND is_active = 1 AND password_hash IS NOT NULL AND id <> ?`,
        )
        .get(exceptId) as { n: number }
    ).n;
  }

  activeAdminsWithPassword(): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM operators
            WHERE role = 'admin' AND is_active = 1 AND password_hash IS NOT NULL`,
        )
        .get() as { n: number }
    ).n;
  }
}
