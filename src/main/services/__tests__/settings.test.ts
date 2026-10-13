import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SettingsService } from '../settings-service';
import { SetupService } from '../setup-service';
import { defaultSettings, appSettingsSchema, GSTIN_PATTERN } from '@shared/settings';
import { stateByCode, stateCodeFromGstin } from '@shared/states';

let db: Database;
let settings: SettingsService;

beforeEach(() => {
  db = freshDb();
  settings = new SettingsService(db);
  new SetupService(db).complete(defaultSettings('Test Shop'));
});
afterEach(() => {
  db.close();
});

describe('settings validation', () => {
  it('requires a shop name', () => {
    expect(
      appSettingsSchema.safeParse({ ...defaultSettings('x'), shop: { name: '' } }).success,
    ).toBe(false);
  });

  it('applies documented defaults', () => {
    const s = defaultSettings('Shop');
    expect(s.locale.currency).toBe('INR');
    expect(s.locale.timezone).toBe('Asia/Kolkata');
    expect(s.invoice.prefix).toBe('INV');
    expect(s.invoice.startNumber).toBe(1);
    expect(s.invoice.financialYearStartMonth).toBe(4);
    expect(s.tax.mode).toBe('inclusive');
    expect(s.tax.roundTotalToRupee).toBe(true);
    expect(s.receipt.paperSize).toBe('80mm');
    // Selling into negative stock is blocked unless deliberately enabled.
    expect(s.inventory.allowNegativeStock).toBe(false);
  });

  it('accepts a valid GSTIN and rejects a malformed one', () => {
    expect(GSTIN_PATTERN.test('33AAAAA0000A1Z5')).toBe(true);
    expect(GSTIN_PATTERN.test('33AAAAA0000A1Z')).toBe(false);
    expect(GSTIN_PATTERN.test('AA33AAA0000A1Z5')).toBe(false);
  });

  it('requires at least one payment method', () => {
    expect(() => settings.update({ payment: { methods: [] } })).toThrow();
  });

  it('rejects an invoice prefix with invalid characters', () => {
    expect(() => settings.update({ invoice: { prefix: 'IN V!' } })).toThrow();
  });

  it('rejects a pincode that is not six digits', () => {
    expect(() => settings.update({ shop: { pincode: '123' } })).toThrow();
  });
});

describe('settings updates', () => {
  it('changes one field without disturbing the rest', () => {
    const before = settings.require();
    const after = settings.update({ shop: { phone: '9876543210' } });

    expect(after.shop.phone).toBe('9876543210');
    expect(after.shop.name).toBe(before.shop.name);
    expect(after.invoice).toEqual(before.invoice);
    expect(after.tax).toEqual(before.tax);
  });

  it('persists across service instances', () => {
    settings.update({ tax: { mode: 'exclusive' } });
    expect(new SettingsService(db).require().tax.mode).toBe('exclusive');
  });

  it('updates several sections at once', () => {
    const after = settings.update({
      tax: { mode: 'exclusive' },
      receipt: { paperSize: '58mm' },
      inventory: { allowNegativeStock: true },
    });

    expect(after.tax.mode).toBe('exclusive');
    expect(after.receipt.paperSize).toBe('58mm');
    expect(after.inventory.allowNegativeStock).toBe(true);
  });

  it('uppercases a GSTIN on the way in', () => {
    const after = settings.update({ shop: { gstin: '33aaaaa0000a1z5' } });
    expect(after.shop.gstin).toBe('33AAAAA0000A1Z5');
  });

  it('rejects an invalid update without saving anything', () => {
    const before = settings.require();
    expect(() => settings.update({ shop: { stateCode: 'ZZ' } })).toThrow();
    expect(settings.require()).toEqual(before);
  });
});

describe('state codes', () => {
  it('maps codes to names', () => {
    expect(stateByCode('33')?.name).toBe('Tamil Nadu');
    expect(stateByCode('27')?.name).toBe('Maharashtra');
    expect(stateByCode('99')).toBeUndefined();
  });

  it('extracts the state code embedded in a GSTIN', () => {
    expect(stateCodeFromGstin('33AAAAA0000A1Z5')).toBe('33');
    expect(stateCodeFromGstin('bad')).toBeNull();
  });
});

describe('a partial update', () => {
  it('leaves the rest of the section exactly as it was', () => {
    const service = new SettingsService(db);
    const base = defaultSettings('Test Shop');
    service.replaceAll({
      ...base,
      receipt: { ...base.receipt, paperSize: '58mm', silentPrint: true, printerName: 'EPSON-1' },
      backup: { ...base.backup, directory: '/tmp/backups', keepCount: 3 },
    });

    // Zod reapplies defaults for keys a partial patch omits; the service must
    // not let that reset fields the operator never touched.
    const after = service.update({ receipt: { footerText: 'Thank you' } });

    expect(after.receipt.footerText).toBe('Thank you');
    expect(after.receipt.paperSize).toBe('58mm');
    expect(after.receipt.silentPrint).toBe(true);
    expect(after.receipt.printerName).toBe('EPSON-1');

    const afterBackup = service.update({ backup: { lastRunAt: '2026-10-13T06:00:00.000Z' } });
    expect(afterBackup.backup.keepCount).toBe(3);
    expect(afterBackup.backup.directory).toBe('/tmp/backups');
  });
});

describe('settings written by an older version', () => {
  it('load, with any section this version added filled from its defaults', () => {
    // Simulates an update: the stored rows predate the backup section.
    db.prepare("DELETE FROM settings WHERE key = 'settings.backup'").run();

    const loaded = new SettingsService(db).get();

    expect(loaded).not.toBeNull();
    expect(loaded?.backup.autoEnabled).toBe(false);
    expect(loaded?.backup.directory).toBeNull();
    expect(loaded?.shop.name).toBe('Test Shop');
  });
});
