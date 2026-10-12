import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv, escapeCsvField } from '../csv';

describe('parseCsv', () => {
  it('parses a simple file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // A naive split would turn this into three products.
    expect(parseCsv('name,price\n"Rice, Basmati 5kg",499')).toEqual([
      ['name', 'price'],
      ['Rice, Basmati 5kg', '499'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('name\n"6"" pipe"')).toEqual([['name'], ['6" pipe']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('name,note\nRice,"line one\nline two"')).toEqual([
      ['name', 'note'],
      ['Rice', 'line one\nline two'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header is usable', () => {
    expect(parseCsv('﻿name,price\nRice,499')[0]).toEqual(['name', 'price']);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('toCsv', () => {
  it('quotes only what needs it', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('has,comma')).toBe('"has,comma"');
    expect(escapeCsvField('has"quote')).toBe('"has""quote"');
  });

  it('writes nulls as empty cells', () => {
    expect(toCsv([['a', null, undefined, 1]])).toBe('a,,,1');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['name', 'price', 'note'],
      ['Rice, Basmati', '499.00', 'says "best"'],
      ['Plain', '10', ''],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
