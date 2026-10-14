/**
 * A QR code, drawn here rather than fetched.
 *
 * A bill that says "UPI sharma@okbank" asks a customer to type it; a bill with
 * a square asks them to point a camera. The app has no internet and takes no
 * dependency it does not need, so the code is encoded from first principles:
 * byte mode, error correction level M, the smallest version that fits.
 *
 * Only what a payment link needs is implemented — one mode, one correction
 * level, versions 1 to 10 — and anything longer is refused rather than
 * silently truncated, because a QR that scans to half a payment URI is worse
 * than no QR at all.
 */

/** Modules per side for versions 1..10: 21, 25, 29 ... */
const sizeOf = (version: number): number => version * 4 + 17;

/** Byte-mode capacity at correction level M, versions 1..10. */
const CAPACITY_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

/** Total codewords and the error-correction blocks, level M, versions 1..10. */
const BLOCKS_M: { total: number; ecPerBlock: number; group: [number, number][] }[] = [
  { total: 0, ecPerBlock: 0, group: [] },
  { total: 26, ecPerBlock: 10, group: [[1, 16]] },
  { total: 44, ecPerBlock: 16, group: [[1, 28]] },
  { total: 70, ecPerBlock: 26, group: [[1, 44]] },
  { total: 100, ecPerBlock: 18, group: [[2, 32]] },
  { total: 134, ecPerBlock: 24, group: [[2, 43]] },
  { total: 172, ecPerBlock: 16, group: [[4, 27]] },
  { total: 196, ecPerBlock: 18, group: [[4, 31]] },
  { total: 242, ecPerBlock: 22, group: [[2, 38], [2, 39]] },
  { total: 292, ecPerBlock: 22, group: [[3, 36], [2, 37]] },
  { total: 346, ecPerBlock: 26, group: [[4, 43], [1, 44]] },
];

/** Where the alignment patterns sit, by version. */
const ALIGNMENT: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// ── Galois field arithmetic, for the error correction codewords ────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR field's generator polynomial
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
}

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[((LOG[a] as number) + (LOG[b] as number)) % 255] as number);

/**
 * The generator polynomial for `degree` error-correction codewords, highest
 * power first — which is the order the division below reads it in.
 */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ (poly[j] as number); // multiplied by x
      next[j + 1] = (next[j + 1] as number) ^ mul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

function errorCodewords(data: number[], count: number): number[] {
  const gen = generator(count);
  const remainder = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < gen.length - 1; i += 1) {
      remainder[i] = (remainder[i] as number) ^ mul(gen[i + 1] as number, factor);
    }
  }
  return remainder;
}

// ── The bit stream ─────────────────────────────────────────────────────────
class Bits {
  readonly values: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.values.push((value >>> i) & 1);
  }

  get length(): number {
    return this.values.length;
  }
}

function encodeData(text: string, version: number): number[] {
  const bytes = new TextEncoder().encode(text);
  const bits = new Bits();

  bits.push(0b0100, 4); // byte mode
  bits.push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) bits.push(byte, 8);

  const capacityBits = dataCodewords(version) * 8;
  // The terminator, then padding to a whole codeword.
  bits.push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0, 1);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits.values[i + j] as number);
    codewords.push(byte);
  }

  // The pad bytes the specification names, alternating from the first one
  // every time — not from whichever one the length happens to land on.
  const pad = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCodewords(version); i += 1)
    codewords.push(pad[i % 2] as number);

  return codewords;
}

const dataCodewords = (version: number): number => {
  const spec = BLOCKS_M[version] as (typeof BLOCKS_M)[number];
  return spec.group.reduce((sum, [count, size]) => sum + count * size, 0);
};

/** Data and error codewords, interleaved as the specification requires. */
function finalCodewords(text: string, version: number): number[] {
  const spec = BLOCKS_M[version] as (typeof BLOCKS_M)[number];
  const stream = encodeData(text, version);

  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (const [count, size] of spec.group) {
    for (let i = 0; i < count; i += 1) {
      const data = stream.slice(at, at + size);
      at += size;
      blocks.push({ data, ec: errorCodewords(data, spec.ecPerBlock) });
    }
  }

  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1)
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i] as number);
  for (let i = 0; i < spec.ecPerBlock; i += 1)
    for (const block of blocks) out.push(block.ec[i] as number);

  return out;
}

// ── The matrix ─────────────────────────────────────────────────────────────
type Grid = (0 | 1 | null)[][];

function blank(version: number): { grid: Grid; reserved: boolean[][] } {
  const size = sizeOf(version);
  const grid: Grid = Array.from({ length: size }, () => new Array<0 | 1 | null>(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const put = (x: number, y: number, value: 0 | 1): void => {
    (grid[y] as (0 | 1 | null)[])[x] = value;
    (reserved[y] as boolean[])[x] = true;
  };

  const finder = (ox: number, oy: number): void => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const ring = x >= 0 && x <= 6 && (y === 0 || y === 6);
        const column = y >= 0 && y <= 6 && (x === 0 || x === 6);
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        put(px, py, ring || column || core ? 1 : 0);
      }
    }
  };

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (const centre of ALIGNMENT[version] as number[]) {
    for (const other of ALIGNMENT[version] as number[]) {
      // Not where a finder pattern already is.
      const nearFinder =
        (centre === 6 && other === 6) ||
        (centre === 6 && other === size - 7) ||
        (centre === size - 7 && other === 6);
      if (nearFinder) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          const edge = Math.max(Math.abs(x), Math.abs(y));
          put(other + x, centre + y, edge === 1 ? 0 : 1);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    const value: 0 | 1 = i % 2 === 0 ? 1 : 0;
    put(i, 6, value);
    put(6, i, value);
  }

  put(8, size - 8, 1); // the dark module, always set

  // From version 7 two blocks carry the version itself; written later, but
  // the squares are claimed now so no data is laid into them.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const row = Math.floor(i / 3);
      const column = i % 3;
      put(size - 11 + column, row, 0);
      put(row, size - 11 + column, 0);
    }
  }

  // Format information: written later, but the squares are claimed now.
  for (let i = 0; i < 9; i += 1) {
    if (!(reserved[8] as boolean[])[i]) put(i, 8, 0);
    if (!(reserved[i] as boolean[])[8]) put(8, i, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!(reserved[8] as boolean[])[size - 1 - i]) put(size - 1 - i, 8, 0);
    if (!(reserved[size - 1 - i] as boolean[])[8]) put(8, size - 1 - i, 0);
  }

  return { grid, reserved };
}

/** Walks the two-module-wide columns from the bottom right, as the spec does. */
function placeData(grid: Grid, reserved: boolean[][], codewords: number[]): void {
  const size = grid.length;
  let bit = 0;
  const next = (): 0 | 1 => {
    const byte = codewords[bit >> 3];
    const value = byte === undefined ? 0 : (byte >> (7 - (bit % 8))) & 1;
    bit += 1;
    return value as 0 | 1;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // the timing column is not part of the walk
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if ((reserved[y] as boolean[])[x]) continue;
        (grid[y] as (0 | 1 | null)[])[x] = next();
      }
    }
    upward = !upward;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Level M, with the mask number, as the 15 bits the spec tabulates. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 00 is level M
  let value = data << 10;
  for (let i = 14; i >= 10; i -= 1) if ((value >>> i) & 1) value ^= 0b10100110111 << (i - 10);
  return ((data << 10) | value) ^ 0b101010000010010;
}

/**
 * From version 7 the symbol states its own version twice, near the top-right
 * and bottom-left finders: six bits of version and twelve of correction, as
 * the specification's polynomial gives them.
 */
function versionBits(version: number): number {
  let value = version << 12;
  for (let i = 17; i >= 12; i -= 1) if ((value >>> i) & 1) value ^= 0b1111100100101 << (i - 12);
  return (version << 12) | value;
}

function writeVersion(grid: Grid, reserved: boolean[][], version: number): void {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);

  for (let i = 0; i < 18; i += 1) {
    const value = ((bits >> i) & 1) as 0 | 1;
    const row = Math.floor(i / 3);
    const column = i % 3;

    (grid[row] as (0 | 1 | null)[])[size - 11 + column] = value;
    (reserved[row] as boolean[])[size - 11 + column] = true;

    (grid[size - 11 + column] as (0 | 1 | null)[])[row] = value;
    (reserved[size - 11 + column] as boolean[])[row] = true;
  }
}

function writeFormat(grid: Grid, mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask);

  for (let i = 0; i < 15; i += 1) {
    const value = ((bits >> i) & 1) as 0 | 1;

    // Down the left of the top-right finder, skipping the timing row and the
    // dark module; and along the top of the bottom-left one.
    const y = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    (grid[y] as (0 | 1 | null)[])[8] = value;

    // The second copy, read the other way round: from the right edge of the
    // row, then back across towards the corner, stepping over the timing
    // column at 6 as the specification does.
    const x = i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i;
    (grid[8] as (0 | 1 | null)[])[x] = value;
  }
}

/** The penalty the specification defines, to choose between the eight masks. */
function penalty(grid: Grid): number {
  const size = grid.length;
  const at = (x: number, y: number): number => ((grid[y] as (0 | 1 | null)[])[x] as number) ?? 0;
  let score = 0;

  // Runs of five or more of one colour, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const previous = horizontal ? at(j - 1, i) : at(i, j - 1);
        const current = horizontal ? at(j, i) : at(i, j);
        if (current === previous) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Two-by-two squares of one colour.
  for (let y = 0; y < size - 1; y += 1)
    for (let x = 0; x < size - 1; x += 1)
      if (at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1))
        score += 3;

  // The finder-like run, which a scanner could mistake for a corner.
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversed = [...pattern].reverse();
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + pattern.length <= size; j += 1) {
      const row = pattern.every((v, k) => at(j + k, i) === v);
      const rowBack = reversed.every((v, k) => at(j + k, i) === v);
      const column = pattern.every((v, k) => at(i, j + k) === v);
      const columnBack = reversed.every((v, k) => at(i, j + k) === v);
      if (row || rowBack) score += 40;
      if (column || columnBack) score += 40;
    }
  }

  // A code that is mostly one colour is harder to read.
  let dark = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) dark += at(x, y);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** The smallest version that holds the text at correction level M. */
function versionFor(text: string): number {
  const length = new TextEncoder().encode(text).length;
  for (let version = 1; version <= 10; version += 1)
    if (length <= (CAPACITY_M[version] as number)) return version;
  throw new Error('That is too long for a QR code of this kind.');
}

/** The modules of the code, row by row: 1 is dark. */
export function qrMatrix(text: string): (0 | 1)[][] {
  if (text.length === 0) throw new Error('There is nothing to encode.');
  const version = versionFor(text);
  const codewords = finalCodewords(text, version);

  let best: { grid: Grid; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const { grid, reserved } = blank(version);
    writeVersion(grid, reserved, version);
    placeData(grid, reserved, codewords);

    const masked: Grid = grid.map((row, y) =>
      row.map((value, x) =>
        (reserved[y] as boolean[])[x]
          ? value
          : ((((value as number) ^ ((MASKS[mask] as (x: number, y: number) => boolean)(x, y) ? 1 : 0)) as 0 | 1)),
      ),
    );
    writeFormat(masked, mask);

    const score = penalty(masked);
    if (!best || score < best.score) best = { grid: masked, score };
  }

  return (best as { grid: Grid }).grid.map((row) => row.map((value) => (value ?? 0) as 0 | 1));
}

/**
 * The code as an SVG, sized in millimetres for print. The quiet zone is part
 * of the symbol: a code printed hard against a table rule does not scan.
 */
export function qrSvg(text: string, sizeMm: number): string {
  const matrix = qrMatrix(text);
  const quiet = 4;
  const span = matrix.length + quiet * 2;

  let path = '';
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 1) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges" role="img" aria-label="Payment code"><rect width="${span}" height="${span}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/**
 * A UPI payment link, as the apps on a phone understand it. The amount is in
 * rupees with two decimals, which is what the scheme expects, and everything
 * is escaped — a shop called "Ravi & Sons" must not break the link.
 */
export function upiLink(input: {
  vpa: string;
  payee: string;
  amountPaise: number;
  note?: string;
}): string {
  const parts: [string, string][] = [
    ['pa', input.vpa.trim()],
    ['pn', input.payee],
    ['am', (input.amountPaise / 100).toFixed(2)],
    ['cu', 'INR'],
  ];
  if (input.note) parts.push(['tn', input.note]);
  return `upi://pay?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
