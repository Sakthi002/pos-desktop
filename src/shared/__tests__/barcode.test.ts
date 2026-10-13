import { describe, it, expect } from 'vitest';
import { barcodeSvg, canEncode, encodeCode128 } from '../barcode';

/**
 * A barcode that prints and does not scan is worse than no barcode, so these
 * check the encoding against the specification rather than against itself:
 * hand-computed check characters, and the structural rules every Code 128
 * symbol obeys.
 */
describe('Code 128', () => {
  it('encodes a single character with the right check symbol', () => {
    // Start B is 104, 'A' is value 33, so the check is (104 + 33) mod 103 = 34.
    const expected =
      '11010010000' + // start B
      '10100011000' + // 'A' (33)
      '10001011000' + // check (34)
      '1100011101011'; // stop

    expect(encodeCode128('A')).toBe(expected);
  });

  it('weights each character by its position in the check', () => {
    // 'AB': (104 + 33*1 + 34*2) mod 103 = 205 mod 103 = 102.
    const expected =
      '11010010000' + // start B
      '10100011000' + // 'A' (33)
      '10001011000' + // 'B' (34)
      '11110101110' + // check (102)
      '1100011101011'; // stop

    expect(encodeCode128('AB')).toBe(expected);
  });

  it('starts with a bar, ends with the stop pattern, and is a multiple of 11 plus 13', () => {
    for (const text of ['RICE5', '8901234567890', 'SGS-1001', 'a-b_c 9']) {
      const bars = encodeCode128(text);
      expect(bars.startsWith('11')).toBe(true);
      expect(bars.endsWith('1100011101011')).toBe(true);
      // start + data + check, all 11 modules, then the 13-module stop.
      expect((bars.length - 13) % 11).toBe(0);
      expect((bars.length - 13) / 11).toBe(text.length + 2);
    }
  });

  it('knows what it cannot encode', () => {
    expect(canEncode('RICE5')).toBe(true);
    expect(canEncode('')).toBe(false);
    expect(canEncode('चाय')).toBe(false);
    expect(() => encodeCode128('चाय')).toThrow();
  });

  it('draws an SVG sized in millimetres, with quiet zones', () => {
    const svg = barcodeSvg('RICE5', { widthMm: 40, heightMm: 15 });

    expect(svg).toContain('width="40mm"');
    expect(svg).toContain('height="15mm"');
    // Ten modules of quiet zone each side of the symbol.
    const bars = encodeCode128('RICE5');
    expect(svg).toContain(`viewBox="0 0 ${bars.length + 20} 100"`);
    expect(svg).toContain('<rect x="10"');
  });
});
