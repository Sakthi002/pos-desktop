import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { freshDb } from '../../db/__tests__/helpers';
import { SetupService } from '../setup-service';
import { CatalogueService } from '../catalogue-service';
import { defaultSettings } from '@shared/settings';
import { parseCsv } from '@shared/csv';

/** Byte order mark Excel writes; kept as a char code, not a literal. */
const BOM = String.fromCharCode(0xfeff);

let db: Database;
let catalogue: CatalogueService;

beforeEach(() => {
  db = freshDb();
  new SetupService(db).complete(defaultSettings('Test Shop'));
  catalogue = new CatalogueService(db);
});
afterEach(() => {
  db.close();
});

const HEADER =
  'sku,barcode,name,category,brand,hsn,unit,cost,price,mrp,tax_rate,tax_inclusive,track_inventory,reorder_level,opening_stock';

describe('csv import', () => {
  it('imports a well-formed file', () => {
    const csv = `${HEADER}
RICE5,8901234567890,Basmati Rice 5kg,Grocery,India Gate,1006,pc,380.00,499.00,550.00,5.00,yes,yes,10,50`;

    const result = catalogue.importCsv({ csv, updateExisting: false });

    expect(result).toMatchObject({ imported: 1, updated: 0, skipped: 0 });
    expect(result.errors).toEqual([]);

    const product = catalogue.search({ search: 'RICE5', status: 'all' }).items[0];
    expect(product).toMatchObject({
      sku: 'RICE5',
      name: 'Basmati Rice 5kg',
      pricePaise: 49900,
      costPaise: 38000,
      taxRateBp: 500,
      stockMilli: 50000,
    });
    expect(product?.categoryName).toBe('Grocery');
  });

  it('creates categories named in the file', () => {
    const csv = `${HEADER}
A,,Item A,Grocery,,,pc,,10.00,,5,yes,yes,,0
B,,Item B,Beverages,,,pc,,20.00,,5,yes,yes,,0`;

    catalogue.importCsv({ csv, updateExisting: false });
    expect(
      catalogue
        .listCategories()
        .map((c) => c.name)
        .sort(),
    ).toEqual(['Beverages', 'Grocery']);
  });

  it('handles fractional quantities for weight units', () => {
    const csv = `${HEADER}
SUG,,Sugar,,,,kg,38.00,45.00,,5,yes,yes,5,25.5`;

    catalogue.importCsv({ csv, updateExisting: false });
    expect(catalogue.search({ search: 'Sugar', status: 'all' }).items[0]?.stockMilli).toBe(25500);
  });

  it('reports a bad price with its row number, and skips only that row', () => {
    const csv = `${HEADER}
GOOD,,Good Item,,,,pc,,10.00,,5,yes,yes,,0
BAD,,Bad Item,,,,pc,,not-a-price,,5,yes,yes,,0
ALSOGOOD,,Another,,,,pc,,20.00,,5,yes,yes,,0`;

    const result = catalogue.importCsv({ csv, updateExisting: false });

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      { row: 3, field: 'price', message: 'Invalid price "not-a-price"' },
    ]);
  });

  it('rejects a fractional quantity for a whole unit', () => {
    const csv = `${HEADER}
PC,,Piece Item,,,,pc,,10.00,,5,yes,yes,,2.5`;

    const result = catalogue.importCsv({ csv, updateExisting: false });
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2, field: 'opening_stock' });
  });

  it('rejects an unknown unit', () => {
    const csv = `${HEADER}
X,,Item,,,,furlong,,10.00,,5,yes,yes,,0`;

    const result = catalogue.importCsv({ csv, updateExisting: false });
    expect(result.errors[0]).toMatchObject({ field: 'unit', message: 'Unknown unit "furlong"' });
  });

  it('skips an existing SKU unless updating is enabled', () => {
    const csv = `${HEADER}
RICE5,,Basmati Rice,,,,pc,,499.00,,5,yes,yes,,10`;

    expect(catalogue.importCsv({ csv, updateExisting: false }).imported).toBe(1);

    const second = catalogue.importCsv({ csv, updateExisting: false });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.errors[0]?.message).toMatch(/already exists/);
  });

  it('updates an existing SKU when asked', () => {
    catalogue.importCsv({
      csv: `${HEADER}\nRICE5,,Basmati Rice,,,,pc,,499.00,,5,yes,yes,,10`,
      updateExisting: false,
    });

    const result = catalogue.importCsv({
      csv: `${HEADER}\nRICE5,,Basmati Rice Premium,,,,pc,,599.00,,5,yes,yes,,0`,
      updateExisting: true,
    });

    expect(result).toMatchObject({ imported: 0, updated: 1 });

    const product = catalogue.search({ search: 'RICE5', status: 'all' }).items[0];
    expect(product?.name).toBe('Basmati Rice Premium');
    expect(product?.pricePaise).toBe(59900);
    // An update must not re-apply opening stock.
    expect(product?.stockMilli).toBe(10000);
  });

  it('keeps names containing commas intact', () => {
    const csv = `${HEADER}
X,,"Rice, Basmati 5kg",,,,pc,,499.00,,5,yes,yes,,0`;

    catalogue.importCsv({ csv, updateExisting: false });
    expect(catalogue.search({ status: 'all' }).items[0]?.name).toBe('Rice, Basmati 5kg');
  });

  it('requires name and price columns', () => {
    expect(() => catalogue.importCsv({ csv: 'sku,barcode\nA,B', updateExisting: false })).toThrow(
      /must have at least "name" and "price"/,
    );
  });

  it('rejects a file with no data rows', () => {
    expect(() => catalogue.importCsv({ csv: HEADER, updateExisting: false })).toThrow(
      /no data rows/,
    );
  });

  it('tolerates a BOM and CRLF from Excel', () => {
    const csv = `${BOM}${HEADER}\r\nX,,Item,,,,pc,,10.00,,5,yes,yes,,0\r\n`;
    expect(catalogue.importCsv({ csv, updateExisting: false }).imported).toBe(1);
  });
});

describe('csv export', () => {
  it('round-trips through import', () => {
    catalogue.importCsv({
      csv: `${HEADER}
RICE5,8901234567890,"Rice, Basmati",Grocery,India Gate,1006,pc,380.00,499.00,550.00,5.00,yes,yes,10,50
SUG,,Sugar,Grocery,,1701,kg,38.00,45.00,,5.00,yes,yes,5,25.5`,
      updateExisting: false,
    });

    const exported = catalogue.exportCsv();
    const rows = parseCsv(exported);

    expect(rows[0]).toEqual([...CatalogueService.CSV_HEADERS]);
    expect(rows).toHaveLength(3);

    const rice = rows.find((r) => r[0] === 'RICE5');
    expect(rice?.[2]).toBe('Rice, Basmati');
    expect(rice?.[8]).toBe('499.00');
    expect(rice?.[14]).toBe('50');

    const sugar = rows.find((r) => r[0] === 'SUG');
    expect(sugar?.[14]).toBe('25.5');
  });

  it('re-imports its own export into a clean database', () => {
    catalogue.importCsv({
      csv: `${HEADER}\nRICE5,,Rice,Grocery,,1006,pc,380.00,499.00,,5.00,yes,yes,10,50`,
      updateExisting: false,
    });
    const exported = catalogue.exportCsv();

    const other = freshDb();
    new SetupService(other).complete(defaultSettings('Second Shop'));
    const result = new CatalogueService(other).importCsv({ csv: exported, updateExisting: false });

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1);
    other.close();
  });

  it('provides a usable template', () => {
    const template = catalogue.csvTemplate();
    const result = catalogue.importCsv({ csv: template, updateExisting: false });
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
  });
});
