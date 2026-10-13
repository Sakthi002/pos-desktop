import type { CSSProperties } from 'react';

/**
 * The six colours the app draws with.
 *
 * A screen, a card or a category keeps the same one everywhere it appears, so
 * colour means something rather than decorating. They are handed to CSS as two
 * custom properties, which lets one rule style the chip, the stripe and the
 * active state without a class per colour.
 */
export const HUES = ['indigo', 'violet', 'teal', 'amber', 'rose', 'sky'] as const;

export type Hue = (typeof HUES)[number];

export function hueStyle(hue: Hue): CSSProperties {
  return {
    ['--hue' as string]: `var(--c-${hue})`,
    ['--hue-tint' as string]: `var(--c-${hue}-tint)`,
  };
}

/**
 * A stable colour for a name. The same category keeps its colour between
 * sessions and between screens, because the name is all it depends on.
 */
export function hueFor(name: string): Hue {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum = (sum + name.charCodeAt(i) * (i + 1)) % 997;
  return HUES[sum % HUES.length] as Hue;
}
