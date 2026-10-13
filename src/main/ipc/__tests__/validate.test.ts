import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validatePayload } from '../validate';
import { ipcContract, type IpcChannel } from '@shared/ipc-contract';

const channels = Object.keys(ipcContract) as IpcChannel[];

/** Shapes a compromised or buggy renderer might send. */
const HOSTILE: unknown[] = [
  undefined,
  null,
  'a string',
  42,
  true,
  [],
  {},
  { __proto__: { polluted: true } },
  { toString: 'not a function' },
  'x'.repeat(5000),
  { id: "'; DROP TABLE sales; --" },
  { id: 1 },
];

describe('every channel validates its payload', () => {
  it('rejects a payload of the wrong shape on every channel', () => {
    for (const channel of channels) {
      const rejected = HOSTILE.filter((payload) => !validatePayload(channel, payload).ok);
      // Each channel must refuse at least the obviously wrong shapes; a channel
      // that accepted all of these would be taking unvalidated input.
      expect(rejected.length, `${channel} accepted everything`).toBeGreaterThan(0);
    }
  });

  it('reports a failure rather than throwing', () => {
    for (const channel of channels) {
      for (const payload of HOSTILE) {
        expect(() => validatePayload(channel, payload)).not.toThrow();
      }
    }
  });

  it('returns a code the renderer can branch on, and a readable message', () => {
    const result = validatePayload('products:get', { id: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PAYLOAD');
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('identifiers', () => {
  it('insists on a real UUID', () => {
    expect(validatePayload('sales:getReceipt', { id: randomUUID() }).ok).toBe(true);
    expect(validatePayload('sales:getReceipt', { id: '1 OR 1=1' }).ok).toBe(false);
    expect(validatePayload('sales:getReceipt', { id: '' }).ok).toBe(false);
    expect(validatePayload('sales:getReceipt', {}).ok).toBe(false);
  });
});

describe('money and quantity', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    productId: randomUUID(),
    quantityMilli: 1000,
    unitPricePaise: 10000,
    discountPaise: 0,
    ...over,
  });

  const sale = (over: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    lines: [line()],
    cartDiscountPaise: 0,
    payments: [{ method: 'cash', amountPaise: 10000 }],
    ...over,
  });

  it('accepts a well-formed sale', () => {
    expect(validatePayload('sales:create', sale()).ok).toBe(true);
  });

  it('refuses fractional paise, which would mean a float got in', () => {
    expect(
      validatePayload('sales:create', sale({ lines: [line({ unitPricePaise: 99.5 })] })).ok,
    ).toBe(false);
    expect(validatePayload('sales:create', sale({ cartDiscountPaise: 10.01 })).ok).toBe(false);
  });

  it('refuses a negative amount or a zero quantity', () => {
    expect(validatePayload('sales:create', sale({ lines: [line({ quantityMilli: 0 })] })).ok).toBe(
      false,
    );
    expect(
      validatePayload('sales:create', sale({ lines: [line({ unitPricePaise: -100 })] })).ok,
    ).toBe(false);
    expect(
      validatePayload('sales:create', sale({ payments: [{ method: 'cash', amountPaise: -1 }] })).ok,
    ).toBe(false);
  });

  it('refuses a sale with no lines', () => {
    expect(validatePayload('sales:create', sale({ lines: [] })).ok).toBe(false);
  });

  it('accepts a sale with no payment, because credit has none', () => {
    // The service decides whether an unpaid bill is credit or a mistake; the
    // gate only checks the shape.
    expect(validatePayload('sales:create', sale({ payments: [] })).ok).toBe(true);
  });

  it('refuses a payment method the app does not support', () => {
    expect(
      validatePayload('sales:create', sale({ payments: [{ method: 'crypto', amountPaise: 1 }] }))
        .ok,
    ).toBe(false);
  });
});

describe('free text', () => {
  it('is bounded, so a renderer cannot write a novel into a field', () => {
    expect(validatePayload('customers:search', { term: 'x'.repeat(101) }).ok).toBe(false);
    expect(validatePayload('customers:search', { term: 'Ravi' }).ok).toBe(true);
  });

  it('keeps a void reason that means something', () => {
    const id = randomUUID();
    expect(validatePayload('sales:void', { id, reason: 'ab' }).ok).toBe(false);
    expect(validatePayload('sales:void', { id, reason: 'Customer cancelled' }).ok).toBe(true);
  });
});

describe('void channels', () => {
  it('take nothing at all', () => {
    expect(validatePayload('app:getInfo', undefined).ok).toBe(true);
    expect(validatePayload('app:getInfo', { sneaky: true }).ok).toBe(false);
    expect(validatePayload('backup:list', undefined).ok).toBe(true);
    expect(validatePayload('backup:list', 'run').ok).toBe(false);
  });
});

describe('what reaches a handler', () => {
  it('is the parsed value, with any undeclared field stripped out', () => {
    const result = validatePayload('products:search', {
      search: 'rice',
      junk: 'ignored',
      companyId: 'someone-elses-company',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A field the contract does not declare never reaches the handler, so a
    // renderer cannot smuggle in scoping or flags the service did not ask for.
    expect(Object.keys(result.data)).not.toContain('junk');
    expect(Object.keys(result.data)).not.toContain('companyId');
    expect(result.data.search).toBe('rice');
    // Declared fields the caller omitted arrive as their documented defaults.
    expect(result.data.page).toBe(1);
    expect(result.data.status).toBe('active');
  });

  it('trims and normalises where the schema says so', () => {
    const result = validatePayload('catalogue:renameCategory', {
      id: randomUUID(),
      name: '  Grocery  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe('Grocery');
  });
});
