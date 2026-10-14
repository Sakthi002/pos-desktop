import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg, upiLink } from '../qr';

/**
 * The symbol for "SGS-1042", frozen after the encoder was checked against an
 * independent implementation module by module and read back by a scanner. A
 * change here means the codes a shop prints have changed shape, which is a
 * thing to notice rather than to accept.
 */
const SGS_1042 = [
  '#######.##.##.#######',
  '#.....#.##..#.#.....#',
  '#.###.#.##.#..#.###.#',
  '#.###.#...#...#.###.#',
  '#.###.#.#...#.#.###.#',
  '#.....#..####.#.....#',
  '#######.#.#.#.#######',
  '.........#.##........',
  '#..#######..##..#.###',
  '..#.##.#.#..#.##.##.#',
  '..##.##.##.....#...##',
  '#.#.##.#####....#.###',
  '.##.#.##.##..##.#.###',
  '........#..##..##.#.#',
  '#######.###.######...',
  '#.....#.#.####..#.#.#',
  '#.###.#.#..##.##.#...',
  '#.###.#.#..##..#.....',
  '#.###.#..#....###.###',
  '#.....#......###..###',
  '#######.####...###...',
];

const draw = (matrix: (0 | 1)[][]): string[] =>
  matrix.map((row) => row.map((value) => (value ? '#' : '.')).join(''));

describe('qrMatrix', () => {
  it('encodes a known string exactly as it did when it was verified', () => {
    expect(draw(qrMatrix('SGS-1042'))).toEqual(SGS_1042);
  });

  it('grows to the smallest version that holds the text', () => {
    expect(qrMatrix('x'.repeat(10)).length).toBe(21); // version 1
    expect(qrMatrix('x'.repeat(30)).length).toBe(29); // version 3
    expect(qrMatrix('x'.repeat(100)).length).toBe(41); // version 6
    expect(qrMatrix('x'.repeat(180)).length).toBe(53); // version 9
  });

  it('refuses what it cannot hold rather than cutting it short', () => {
    // Half a payment link scans to nothing anyone can pay.
    expect(() => qrMatrix('x'.repeat(400))).toThrow(/too long/);
    expect(() => qrMatrix('')).toThrow(/nothing to encode/);
  });

  it('puts a finder pattern in three corners and none in the fourth', () => {
    const matrix = qrMatrix('SGS-1042');
    const last = matrix.length - 1;
    const centre = (x: number, y: number): number => matrix[y]![x] as number;

    // The middle of each finder is dark, and the ring around it is light.
    for (const [x, y] of [
      [3, 3],
      [last - 3, 3],
      [3, last - 3],
    ] as [number, number][]) {
      expect(centre(x, y)).toBe(1);
      expect(centre(x - 2, y)).toBe(0);
    }
    // The fourth corner carries data, not a finder.
    expect(centre(last - 3, last - 3)).toBe(0);
  });

  it('alternates the timing patterns that a scanner measures by', () => {
    const matrix = qrMatrix('SGS-1042');
    for (let i = 8; i < matrix.length - 8; i += 1) {
      expect(matrix[6]![i]).toBe(i % 2 === 0 ? 1 : 0);
      expect(matrix[i]![6]).toBe(i % 2 === 0 ? 1 : 0);
    }
  });
});

describe('qrSvg', () => {
  it('keeps the quiet zone, which is part of the symbol', () => {
    const svg = qrSvg('SGS-1042', 24);
    // 21 modules and four of margin on each side.
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('width="24mm"');
    expect(svg).toContain('<rect width="29" height="29" fill="#fff"/>');
  });
});

describe('upiLink', () => {
  it('writes the amount in rupees, as the apps expect', () => {
    expect(upiLink({ vpa: 'shop@okbank', payee: 'Shop', amountPaise: 152300 })).toContain(
      'am=1523.00',
    );
    expect(upiLink({ vpa: 'shop@okbank', payee: 'Shop', amountPaise: 99 })).toContain('am=0.99');
  });

  it('escapes a shop name that would otherwise break the link', () => {
    const link = upiLink({
      vpa: 'sharma@okbank',
      payee: 'Sharma & Sons',
      amountPaise: 100,
      note: 'SGS-1042',
    });
    expect(link).toContain('pn=Sharma%20%26%20Sons');
    expect(link).toContain('pa=sharma%40okbank');
    expect(link).toContain('tn=SGS-1042');
    expect(link.startsWith('upi://pay?')).toBe(true);
  });
});
