import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { SettingsService } from '../settings-service';
import { SaleService } from '../sale-service';
import { CatalogueService } from '../catalogue-service';
import { AuthService, AuthError } from '../auth-service';
import { hashPassword, verifyPassword } from '../password';
import { defaultSettings } from '@shared/settings';
import { can, ROLE_PERMISSIONS } from '@shared/permissions';
import * as session from '../../session';

let db: Database;
let auth: AuthService;

const enableLogin = () => {
  new SettingsService(db).update({ security: { requireLogin: true } });
};

beforeEach(() => {
  db = freshDb();
  const base = defaultSettings('Test Shop');
  new SetupService(db).complete({
    ...base,
    shop: { ...base.shop, stateCode: '33', gstin: '33AAAAA0000A1Z5' },
    invoice: { prefix: 'INV', startNumber: 1, financialYearStartMonth: 4 },
  });

  auth = new AuthService(db);
  // The shop seeds one unnamed owner; give it a password so it can sign in.
  const owner = auth.list()[0]!;
  auth.resetPassword({ id: owner.id, password: 'owner-pass' });
});

afterEach(() => {
  session.signOut();
  session.setIdleMinutes(0);
  db.close();
});

describe('hashing a password', () => {
  it('never stores the password, and verifies it anyway', () => {
    const stored = hashPassword('correct horse');

    expect(stored).not.toContain('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('Correct horse', stored)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('treats a missing or corrupt hash as no match', () => {
    expect(verifyPassword('anything', null)).toBe(false);
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$0$0$0$$')).toBe(false);
  });
});

describe('signing in', () => {
  it('starts a session for the right password', () => {
    const state = auth.login({ username: 'owner', password: 'owner-pass' });

    expect(state.session?.username).toBe('owner');
    expect(state.session?.role).toBe('admin');
    expect(state.session?.permissions).toEqual([...ROLE_PERMISSIONS.admin]);
  });

  it('refuses a wrong password and an unknown name with the same words', () => {
    const wrongPassword = (() => {
      try {
        auth.login({ username: 'owner', password: 'nope' });
      } catch (err) {
        return (err as AuthError).message;
      }
      return '';
    })();

    const unknownName = (() => {
      try {
        auth.login({ username: 'nobody', password: 'nope' });
      } catch (err) {
        return (err as AuthError).message;
      }
      return '';
    })();

    expect(wrongPassword).toBe(unknownName);
    expect(auth.state().session).toBeNull();
  });

  it('refuses a deactivated account', () => {
    const cashier = auth.create({
      name: 'Ravi',
      username: 'ravi',
      role: 'cashier',
      password: 'ravi-pass',
    });
    auth.setActive({ id: cashier.id, isActive: false });

    expect(() => auth.login({ username: 'ravi', password: 'ravi-pass' })).toThrow(AuthError);
  });

  it('records the attempt in the audit trail, failed or not', () => {
    try {
      auth.login({ username: 'owner', password: 'wrong' });
    } catch {
      /* expected */
    }
    auth.login({ username: 'owner', password: 'owner-pass' });

    const actions = db
      .prepare("SELECT action FROM audit_logs WHERE entity_type = 'operator' ORDER BY created_at")
      .all() as { action: string }[];

    expect(actions.map((a) => a.action)).toContain('login.failed');
    expect(actions.map((a) => a.action)).toContain('login');
  });
});

describe('what a role may do', () => {
  it('gives a cashier the till and nothing else', () => {
    expect(can('cashier', 'sell')).toBe(true);
    expect(can('cashier', 'sale.void')).toBe(false);
    expect(can('cashier', 'settings.manage')).toBe(false);
    expect(can('manager', 'sale.void')).toBe(true);
    expect(can('manager', 'user.manage')).toBe(false);
    expect(can('admin', 'user.manage')).toBe(true);
  });

  it('allows everything while login is off', () => {
    expect(() => auth.check('user.manage')).not.toThrow();
  });

  it('refuses an act the signed-in role does not cover', () => {
    enableLogin();
    auth.create({ name: 'Ravi', username: 'ravi', role: 'cashier', password: 'ravi-pass' });
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    expect(() => auth.check('sell')).not.toThrow();
    expect(() => auth.check('sale.void')).toThrow(AuthError);
  });

  it('refuses everything when nobody is signed in', () => {
    enableLogin();
    expect(() => auth.check(null)).toThrow(AuthError);
  });
});

describe('the session', () => {
  it('ends itself after the idle time, and says it was the timer', () => {
    new SettingsService(db).update({ security: { requireLogin: true, idleLockMinutes: 1 } });
    auth.login({ username: 'owner', password: 'owner-pass' });

    // Re-sign in with the clock wound back: the session is older than the limit.
    session.signIn({
      ...auth.state().session!,
      signedInAt: new Date().toISOString(),
    });
    session.setIdleMinutes(1);
    const twoMinutes = Date.now() + 2 * 60_000;
    const realNow = Date.now;
    Date.now = () => twoMinutes;

    try {
      const state = auth.state();
      expect(state.session).toBeNull();
      expect(state.locked).toBe(true);
      expect(state.lastUsername).toBe('owner');
    } finally {
      Date.now = realNow;
    }
  });

  it('stamps a sale with whoever is signed in', () => {
    enableLogin();
    const cashier = auth.create({
      name: 'Ravi',
      username: 'ravi',
      role: 'cashier',
      password: 'ravi-pass',
    });
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    const product = new CatalogueService(db).create({
      name: 'Tea 250g',
      sku: 'TEA250',
      unitCode: 'pc',
      pricePaise: 12000,
      taxRateBp: 500,
      taxInclusive: true,
      trackInventory: true,
      reorderLevelMilli: 0,
      isActive: true,
      openingStockMilli: 10000,
    });

    const sale = new SaleService(db).createSale({
      idempotencyKey: crypto.randomUUID(),
      lines: [
        { productId: product.id, quantityMilli: 1000, unitPricePaise: 12000, discountPaise: 0 },
      ],
      cartDiscountPaise: 0,
      payments: [{ method: 'cash', amountPaise: 12000 }],
    });

    const row = db.prepare('SELECT operator_id FROM sales WHERE id = ?').get(sale.id) as {
      operator_id: string;
    };
    expect(row.operator_id).toBe(cashier.id);
  });
});

describe('managing users', () => {
  it('will not leave the shop without an owner who can sign in', () => {
    const owner = auth.list()[0]!;

    expect(() => auth.setActive({ id: owner.id, isActive: false })).toThrow(AuthError);
    expect(() => auth.update({ id: owner.id, name: 'Owner', role: 'cashier' })).toThrow(AuthError);
  });

  it('refuses a username that is already taken', () => {
    auth.create({ name: 'Ravi', username: 'ravi', role: 'cashier', password: 'ravi-pass' });

    expect(() =>
      auth.create({ name: 'Ravi Two', username: 'RAVI', role: 'cashier', password: 'other-pass' }),
    ).toThrow(AuthError);
  });

  it('forces a change of a password somebody else chose', () => {
    enableLogin();
    const cashier = auth.create({
      name: 'Ravi',
      username: 'ravi',
      role: 'cashier',
      password: 'first-pass',
    });
    auth.resetPassword({ id: cashier.id, password: 'temp-pass' });

    auth.login({ username: 'ravi', password: 'temp-pass' });
    expect(auth.state().session?.mustChangePassword).toBe(true);
    // Until it is changed, the session cannot be used for anything else.
    expect(() => auth.check('sell')).toThrow(AuthError);

    auth.changePassword({ currentPassword: 'temp-pass', newPassword: 'ravis-own' });
    expect(auth.state().session?.mustChangePassword).toBe(false);
    expect(() => auth.check('sell')).not.toThrow();
  });

  it('will not change a password without the current one', () => {
    auth.login({ username: 'owner', password: 'owner-pass' });

    expect(() =>
      auth.changePassword({ currentPassword: 'wrong', newPassword: 'something-else' }),
    ).toThrow(AuthError);
  });
});

describe('approval at the till', () => {
  beforeEach(() => {
    new SettingsService(db).update({
      security: { requireLogin: true, approvalRequired: true, approvalAbovePaise: 100000 },
    });
    auth.create({ name: 'Meena', username: 'meena', role: 'manager', password: 'meena-pass' });
    auth.create({ name: 'Ravi', username: 'ravi', role: 'cashier', password: 'ravi-pass' });
  });

  it('lets a cashier undo something small on their own', () => {
    auth.login({ username: 'ravi', password: 'ravi-pass' });
    expect(() => auth.authorise('sale.void', 50000, undefined)).not.toThrow();
  });

  it('stops a cashier above the threshold until a manager signs it off', () => {
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    expect(() => auth.authorise('sale.void', 150000, undefined)).toThrow(AuthError);
    expect(() =>
      auth.authorise('sale.void', 150000, { username: 'meena', password: 'meena-pass' }),
    ).not.toThrow();
    // And the cashier is still the one signed in: approval is not a handover.
    expect(auth.state().session?.username).toBe('ravi');
  });

  it('refuses an approval from somebody who could not do it either', () => {
    auth.create({ name: 'Second', username: 'second', role: 'cashier', password: 'second-pass' });
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    expect(() =>
      auth.authorise('sale.void', 150000, { username: 'second', password: 'second-pass' }),
    ).toThrow(AuthError);
  });

  it('refuses a wrong password from a manager', () => {
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    expect(() =>
      auth.authorise('sale.void', 150000, { username: 'meena', password: 'nope' }),
    ).toThrow(AuthError);
  });

  it('never asks a manager to approve their own act', () => {
    auth.login({ username: 'meena', password: 'meena-pass' });
    expect(() => auth.authorise('sale.void', 5000000, undefined)).not.toThrow();
  });

  it('refuses a cashier outright when approval is turned off', () => {
    new SettingsService(db).update({ security: { approvalRequired: false } });
    auth.login({ username: 'ravi', password: 'ravi-pass' });

    expect(() => auth.authorise('sale.void', 1000, undefined)).toThrow(AuthError);
  });
});
