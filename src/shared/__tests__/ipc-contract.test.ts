import { describe, it, expect } from 'vitest';
import { ipcContract, isChannel } from '../ipc-contract';

describe('ipc contract', () => {
  it('recognises declared channels', () => {
    expect(isChannel('app:getInfo')).toBe(true);
    expect(isChannel('app:getDbStatus')).toBe(true);
  });

  it('rejects undeclared channels', () => {
    expect(isChannel('db:runArbitrarySql')).toBe(false);
    expect(isChannel('')).toBe(false);
    expect(isChannel(42)).toBe(false);
    expect(isChannel(null)).toBe(false);
  });

  it('does not treat inherited Object properties as channels', () => {
    // A renderer could try 'constructor' or 'toString' to slip past a naive
    // `channel in contract` check.
    expect(isChannel('constructor')).toBe(false);
    expect(isChannel('toString')).toBe(false);
    expect(isChannel('__proto__')).toBe(false);
  });

  it('every declared channel carries a schema that validates input', () => {
    for (const [channel, schema] of Object.entries(ipcContract)) {
      expect(schema, `${channel} must declare a schema`).toBeDefined();
      expect(typeof schema.safeParse, `${channel} schema must be parseable`).toBe('function');
    }
  });

  it('void channels reject a payload', () => {
    expect(ipcContract['app:getInfo'].safeParse({ hack: true }).success).toBe(false);
    expect(ipcContract['app:getInfo'].safeParse(undefined).success).toBe(true);
  });
});
