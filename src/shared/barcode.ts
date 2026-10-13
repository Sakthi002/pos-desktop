/**
 * Code 128, drawn as an SVG.
 *
 * Written out rather than taken from a library because it is a hundred lines
 * of table lookup, it has to run in the renderer and the main process alike,
 * and a label that scans is not a thing to leave to a dependency that may stop
 * being maintained.
 *
 * Code set B throughout: it covers every printable ASCII character a shop puts
 * on a label, and switching sets to save three modules on a numeric code is
 * not worth the chance of getting it wrong.
 */

/** Bar and space widths for each of the 107 symbols, in module counts. */
const PATTERNS = [
  '11011001100',
  '11001101100',
  '11001100110',
  '10010011000',
  '10010001100',
  '10001001100',
  '10011001000',
  '10011000100',
  '10001100100',
  '11001001000',
  '11001000100',
  '11000100100',
  '10110011100',
  '10011011100',
  '10011001110',
  '10111001100',
  '10011101100',
  '10011100110',
  '11001110010',
  '11001011100',
  '11001001110',
  '11011100100',
  '11001110100',
  '11101101110',
  '11101001100',
  '11100101100',
  '11100100110',
  '11101100100',
  '11100110100',
  '11100110010',
  '11011011000',
  '11011000110',
  '11000110110',
  '10100011000',
  '10001011000',
  '10001000110',
  '10110001000',
  '10001101000',
  '10001100010',
  '11010001000',
  '11000101000',
  '11000100010',
  '10110111000',
  '10110001110',
  '10001101110',
  '10111011000',
  '10111000110',
  '10001110110',
  '11101110110',
  '11010001110',
  '11000101110',
  '11011101000',
  '11011100010',
  '11011101110',
  '11101011000',
  '11101000110',
  '11100010110',
  '11101101000',
  '11101100010',
  '11100011010',
  '11101111010',
  '11001000010',
  '11110001010',
  '10100110000',
  '10100001100',
  '10010110000',
  '10010000110',
  '10000101100',
  '10000100110',
  '10110010000',
  '10110000100',
  '10011010000',
  '10011000010',
  '10000110100',
  '10000110010',
  '11000010010',
  '11001010000',
  '11110111010',
  '11000010100',
  '10001111010',
  '10100111100',
  '10010111100',
  '10010011110',
  '10111100100',
  '10011110100',
  '10011110010',
  '11110100100',
  '11110010100',
  '11110010010',
  '11011011110',
  '11011110110',
  '11110110110',
  '10101111000',
  '10100011110',
  '10001011110',
  '10111101000',
  '10111100010',
  '11110101000',
  '11110100010',
  '10111011110',
  '10111101110',
  '11101011110',
  '11110101110',
  '11010000100',
  '11010010000',
  '11010011100',
  '1100011101011',
] as const;

const START_B = 104;
const STOP = 106;

/** Value of a character in code set B: printable ASCII starts at space. */
const valueOf = (char: string): number => {
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) return -1;
  return code - 32;
};

/** True when every character can be drawn in code set B. */
export function canEncode(text: string): boolean {
  return text.length > 0 && [...text].every((c) => valueOf(c) >= 0);
}

/** The bar pattern for a string, as a run of 1s and 0s one module wide each. */
export function encodeCode128(text: string): string {
  if (!canEncode(text)) throw new Error('That text cannot go in a Code 128 barcode');

  const values = [...text].map(valueOf);
  // The check character: start value plus each character times its position,
  // modulo 103. Getting this wrong is the usual reason a label will not scan.
  const checksum =
    (START_B + values.reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;

  const symbols = [START_B, ...values, checksum, STOP];
  return symbols.map((symbol) => PATTERNS[symbol] ?? '').join('');
}

/**
 * The barcode as an SVG, sized in millimetres so a label prints at the size it
 * says. Quiet zones are ten modules each side, which is what the specification
 * asks for and what a cheap scanner needs.
 */
export function barcodeSvg(
  text: string,
  options: { widthMm?: number; heightMm?: number } = {},
): string {
  const bars = encodeCode128(text);
  const quiet = 10;
  const modules = bars.length + quiet * 2;
  const widthMm = options.widthMm ?? 32;
  const heightMm = options.heightMm ?? 12;

  let x = quiet;
  let rects = '';
  for (let i = 0; i < bars.length; i += 1) {
    if (bars[i] === '1') {
      // Collapse a run of bars into one rectangle: fewer, cleaner edges.
      let run = 1;
      while (bars[i + run] === '1') run += 1;
      rects += `<rect x="${x}" y="0" width="${run}" height="100" fill="#000"/>`;
      x += run;
      i += run - 1;
    } else {
      x += 1;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" ` +
    `viewBox="0 0 ${modules} 100" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    rects +
    `</svg>`
  );
}
