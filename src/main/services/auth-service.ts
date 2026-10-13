/**
 * Signing in, and who may do what.
 *
 * Three rules shape this file. A password is checked here and nowhere else. A
 * failed sign-in says the same thing whatever was wrong with it, so the screen
 * cannot be used to find out which usernames exist. And the shop can never lock
 * itself out: login cannot be turned on without an administrator who has a
 * password, and the last such administrator cannot be deactivated or demoted.
 */
import type { Database } from 'better-sqlite3';
import {
  approvalSchema,
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  resetPasswordSchema,
  setUserActiveSchema,
  updateUserSchema,
  type Session,
  type SessionState,
  type UserSummary,
} from '@shared/auth';
import { ROLE_PERMISSIONS, can, type Permission, type Role } from '@shared/permissions';
import { UserRepository } from '../db/repositories/users';
import { AuditRepository } from '../db/repositories/audit';
import { inTransaction } from '../db/repositories/base';
import { hashPassword, verifyPassword } from './password';
import { SettingsService } from './settings-service';
import { loadBranchContext } from './branch-context';
import * as session from '../session';

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Deliberately the same message for a wrong name and a wrong password. */
const REFUSED = 'That username and password do not match.';

export class AuthService {
  private readonly users: UserRepository;
  private readonly audit: AuditRepository;

  constructor(private readonly db: Database) {
    this.users = new UserRepository(db);
    this.audit = new AuditRepository(db);
  }

  private requireLogin(): boolean {
    return new SettingsService(this.db).get()?.security.requireLogin ?? false;
  }

  private applyIdleSetting(): void {
    session.setIdleMinutes(new SettingsService(this.db).get()?.security.idleLockMinutes ?? 0);
  }

  private toSession(row: NonNullable<ReturnType<UserRepository['byId']>>): Session {
    const role = row.role as Role;
    return {
      operatorId: row.id,
      name: row.name,
      username: row.username,
      role,
      permissions: [...ROLE_PERMISSIONS[role]],
      signedInAt: new Date().toISOString(),
      mustChangePassword: row.must_change_password === 1,
    };
  }

  /** What the renderer asks on every start, and on a timer after that. */
  state(): SessionState {
    this.applyIdleSetting();
    const current = session.currentSession();
    const settings = new SettingsService(this.db).get();
    return {
      loginRequired: settings?.security.requireLogin ?? false,
      session: current,
      locked: current === null && session.isLocked(),
      lastUsername: session.lastSignedInUsername(),
      approvalAvailable:
        (settings?.security.requireLogin ?? false) &&
        (settings?.security.approvalRequired ?? false),
    };
  }

  login(input: unknown): SessionState {
    const parsed = loginSchema.parse(input);
    const row = this.users.byUsername(parsed.username.toLowerCase());

    if (!row || row.is_active !== 1 || !verifyPassword(parsed.password, row.password_hash)) {
      // Audited, because a run of these is the only sign a shop would get that
      // somebody is trying passwords at the till.
      this.audit.record({
        entityType: 'operator',
        entityId: row?.id ?? null,
        action: 'login.failed',
        operatorId: null,
        details: { username: parsed.username.toLowerCase() },
      });
      throw new AuthError('LOGIN_REFUSED', REFUSED);
    }

    this.users.recordLogin(row.id);
    session.signIn(this.toSession(row));
    this.applyIdleSetting();

    this.audit.record({
      entityType: 'operator',
      entityId: row.id,
      action: 'login',
      operatorId: row.id,
      details: { username: row.username },
    });

    return this.state();
  }

  /** Stepping away from the till: the session ends, the name is kept. */
  lock(): SessionState {
    const current = session.currentSession();
    if (current) {
      this.audit.record({
        entityType: 'operator',
        entityId: current.operatorId,
        action: 'locked',
        operatorId: current.operatorId,
        details: null,
      });
    }
    session.lock();
    return this.state();
  }

  logout(): SessionState {
    const current = session.currentSession();
    if (current) {
      this.audit.record({
        entityType: 'operator',
        entityId: current.operatorId,
        action: 'logout',
        operatorId: current.operatorId,
        details: null,
      });
    }
    session.signOut();
    return this.state();
  }

  /** Changing one's own password, including the forced change after a reset. */
  changePassword(input: unknown): SessionState {
    const parsed = changePasswordSchema.parse(input);
    const current = session.currentSession();
    if (!current) throw new AuthError('NOT_SIGNED_IN', 'Sign in first.');

    const row = this.users.byId(current.operatorId);
    if (!row || !verifyPassword(parsed.currentPassword, row.password_hash)) {
      throw new AuthError('WRONG_PASSWORD', 'That is not the current password.');
    }
    if (parsed.currentPassword === parsed.newPassword) {
      throw new AuthError('SAME_PASSWORD', 'Choose a password you have not just used.');
    }

    this.users.setPassword(current.operatorId, hashPassword(parsed.newPassword), false);
    session.updateSession({ mustChangePassword: false });

    this.audit.record({
      entityType: 'operator',
      entityId: current.operatorId,
      action: 'password.changed',
      operatorId: current.operatorId,
      details: null,
    });

    return this.state();
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  list(): UserSummary[] {
    return this.users.list();
  }

  create(input: unknown): UserSummary {
    const parsed = createUserSchema.parse(input);
    if (this.users.byUsername(parsed.username)) {
      throw new AuthError('USERNAME_TAKEN', 'That username is already in use.');
    }

    const ctx = loadBranchContext(this.db);
    if (!ctx) throw new AuthError('SETUP_INCOMPLETE', 'Complete setup first.');

    const created = inTransaction(this.db, () => {
      const user = this.users.create({
        branchId: ctx.branchId,
        name: parsed.name,
        username: parsed.username,
        role: parsed.role,
        passwordHash: hashPassword(parsed.password),
      });
      this.audit.record({
        entityType: 'operator',
        entityId: user.id,
        action: 'user.created',
        operatorId: session.sessionOperatorId(),
        details: { username: user.username, role: user.role },
      });
      return user;
    });

    return created;
  }

  update(input: unknown): UserSummary {
    const parsed = updateUserSchema.parse(input);
    const row = this.users.byId(parsed.id);
    if (!row) throw new AuthError('NOT_FOUND', 'That user does not exist.');

    // Demoting the last administrator would leave nobody able to add one back.
    if (
      row.role === 'admin' &&
      parsed.role !== 'admin' &&
      this.users.otherActiveAdmins(row.id) < 1
    ) {
      throw new AuthError('LAST_ADMIN', 'This is the only owner account. Make another one first.');
    }

    inTransaction(this.db, () => {
      this.users.update(parsed.id, parsed.name, parsed.role);
      this.audit.record({
        entityType: 'operator',
        entityId: parsed.id,
        action: 'user.updated',
        operatorId: session.sessionOperatorId(),
        details: { name: parsed.name, role: parsed.role },
      });
    });

    if (session.currentSession()?.operatorId === parsed.id) {
      session.updateSession({
        name: parsed.name,
        role: parsed.role,
        permissions: [...ROLE_PERMISSIONS[parsed.role]],
      });
    }

    return this.users.list().find((u) => u.id === parsed.id) as UserSummary;
  }

  setActive(input: unknown): UserSummary {
    const parsed = setUserActiveSchema.parse(input);
    const row = this.users.byId(parsed.id);
    if (!row) throw new AuthError('NOT_FOUND', 'That user does not exist.');

    if (!parsed.isActive) {
      if (session.currentSession()?.operatorId === parsed.id) {
        throw new AuthError('SELF_DEACTIVATE', 'You cannot deactivate the account you are using.');
      }
      if (row.role === 'admin' && this.users.otherActiveAdmins(row.id) < 1) {
        throw new AuthError('LAST_ADMIN', 'This is the only owner account.');
      }
    }

    inTransaction(this.db, () => {
      this.users.setActive(parsed.id, parsed.isActive);
      this.audit.record({
        entityType: 'operator',
        entityId: parsed.id,
        action: parsed.isActive ? 'user.reactivated' : 'user.deactivated',
        operatorId: session.sessionOperatorId(),
        details: { username: row.username },
      });
    });

    return this.users.list().find((u) => u.id === parsed.id) as UserSummary;
  }

  /**
   * An administrator setting someone else's password. It is marked as needing
   * a change, so the password the administrator chose is used exactly once.
   */
  resetPassword(input: unknown): UserSummary {
    const parsed = resetPasswordSchema.parse(input);
    const row = this.users.byId(parsed.id);
    if (!row) throw new AuthError('NOT_FOUND', 'That user does not exist.');

    const self = session.currentSession()?.operatorId === parsed.id;

    inTransaction(this.db, () => {
      this.users.setPassword(parsed.id, hashPassword(parsed.password), !self);
      this.audit.record({
        entityType: 'operator',
        entityId: parsed.id,
        action: 'password.reset',
        operatorId: session.sessionOperatorId(),
        details: { username: row.username },
      });
    });

    if (self) session.updateSession({ mustChangePassword: false });

    return this.users.list().find((u) => u.id === parsed.id) as UserSummary;
  }

  // ─── Gates ────────────────────────────────────────────────────────────────

  /**
   * The permission check the IPC layer runs. With login off there is nobody to
   * check, and everything is allowed — the shop has chosen to be one operator.
   */
  check(permission: Permission | null): void {
    if (!this.requireLogin()) return;

    this.applyIdleSetting();
    const current = session.currentSession();
    if (!current) throw new AuthError('NOT_SIGNED_IN', 'Sign in to continue.');

    if (current.mustChangePassword) {
      throw new AuthError('PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
    }

    if (permission && !can(current.role, permission)) {
      throw new AuthError('NOT_ALLOWED', 'Your role does not allow that. Ask a manager.');
    }
  }

  /**
   * A manager approving one act at the till. Their credentials are checked and
   * discarded; the session does not change hands.
   */
  approve(permission: Permission, input: unknown): { operatorId: string; username: string } {
    const parsed = approvalSchema.parse(input);
    const row = this.users.byUsername(parsed.username.toLowerCase());

    if (!row || row.is_active !== 1 || !verifyPassword(parsed.password, row.password_hash)) {
      throw new AuthError('APPROVAL_REFUSED', REFUSED);
    }
    if (!can(row.role as Role, permission)) {
      throw new AuthError('APPROVAL_NOT_ALLOWED', 'That account cannot approve this.');
    }

    this.audit.record({
      entityType: 'operator',
      entityId: row.id,
      action: 'approval.given',
      operatorId: session.sessionOperatorId(),
      details: { approvedBy: row.username, permission },
    });

    return { operatorId: row.id, username: row.username };
  }

  /**
   * The two-sided check for an act a shop may want watched: a void, a return.
   *
   * A role that covers the act does it alone. A role that does not may still
   * do a small one — the shop sets where small ends — and anything larger
   * needs somebody whose role does cover it to put their password behind it.
   * With approval turned off the role is the whole answer.
   */
  authorise(permission: Permission, valuePaise: number, approval: unknown): void {
    this.check(null);

    const settings = new SettingsService(this.db).get();
    if (!settings?.security.requireLogin) return;

    const current = session.currentSession();
    if (!current) throw new AuthError('NOT_SIGNED_IN', 'Sign in to continue.');
    if (can(current.role, permission)) return;

    const rules = settings.security;
    if (!rules.approvalRequired) {
      throw new AuthError('NOT_ALLOWED', 'Your role does not allow that. Ask a manager.');
    }
    if (valuePaise <= rules.approvalAbovePaise) return;

    if (!approval) {
      throw new AuthError(
        'APPROVAL_REQUIRED',
        'This one is above what you can do on your own. Ask a manager to sign it off.',
      );
    }
    this.approve(permission, approval);
  }
}
