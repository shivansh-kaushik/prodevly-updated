/**
 * WCAG 2.2 contrast for the home page's field and ink pairs (docs/CONTRACT.md 2:
 * "check AA contrast on every field and ink pair"). The colours are read from the
 * `@theme` tokens in globals.css, so a palette edit is checked, not assumed.
 */
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `--color-name: #hex;` declarations. */
export function tokensOf(css) {
  const out = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

/**
 * [text, background, minimum, where]. 4.5 for text of any size; 3 where the design
 * only ever sets large text (24px, or 18.66px bold) on that field.
 */
export const PAIRS = [
  ['chalk', 'cobalt', 4.5, 'hero copy'],
  ['graphite', 'chalk', 4.5, 'services copy and the chalk keys'],
  ['graphite', 'yolk', 4.5, 'work copy and the yolk keys'],
  ['graphite', 'mint', 4.5, 'pricing copy and the mint keys'],
  ['chalk', 'tomato', 3, 'team heading (large type only on the tomato field)'],
  ['chalk', 'graphite', 4.5, 'contact copy, the nav and the footer'],
  ['chalk', 'tomato-key', 4.5, 'labels on tomato keys'],
  ['graphite', 'white', 4.5, 'service tiles'],
  ['yolk', 'graphite', 4.5, 'tags on cards'],
  ['mint', 'graphite', 4.5, 'price on the dark plan card'],
  ['graphite', 'chalk', 4.5, 'cards'],
];

export function checkContrast(css, pairs = PAIRS) {
  const tokens = { white: '#ffffff', ...tokensOf(css) };
  return pairs.map(([text, bg, min, where]) => {
    const a = tokens[text];
    const b = tokens[bg];
    if (!a || !b) return { text, bg, min, where, ratio: 0, ok: false, missing: [text, bg].filter((t) => !tokens[t]) };
    const ratio = contrast(a, b);
    return { text, bg, min, where, ratio, ok: ratio >= min };
  });
}
