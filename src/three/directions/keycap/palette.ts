/**
 * The Keycap Colorway palette (docs/plan/directions.json, id `keys`). Colours enter
 * the scene as sRGB hex; NeutralToneMapping keeps the hue. `SIDE` is the darker skirt
 * of each colour, used by the DOM keys and the grounding tints.
 */
export const HEX = {
  chalk: '#EEF1F0',
  graphite: '#1B1D22',
  cobalt: '#2340C8',
  tomato: '#E5362C',
  yolk: '#F6C12B',
  mint: '#8FD8C0',
} as const;

export const SIDE = {
  chalk: '#C7CECB',
  graphite: '#08090B',
  cobalt: '#162A8E',
  tomato: '#A9221B',
  yolk: '#C9920E',
  mint: '#5FAE95',
} as const;

export type ColourName = keyof typeof HEX;

/** Page field per station (the DOM paints it; the stage only tints its light by it). */
export const FIELD: Record<string, ColourName> = {
  hero: 'cobalt',
  services: 'chalk',
  work: 'yolk',
  pricing: 'mint',
  team: 'tomato',
  contact: 'graphite',
};
