import { HEX, type ColourName } from '@/three/directions/keycap/palette';

/**
 * The cast: nine caps that stay the same objects through every chapter (the
 * contract's "signature beats are continuous transforms of the same objects").
 * Index order is the order every layout table uses.
 */
export const SPACE = 0;
export const SHIFT = 1;
export const ENTER = 2;
export const TAB = 3;
export const CMD = 4;
export const ESC = 5;
export const OPT = 6;
export const FN = 7;
export const ART = 8;

export interface CapSpec {
  id: string;
  /** Width in key units. */
  u: number;
  h: number;
  /** The one resin cap (glossy hero object). */
  art?: boolean;
  col: ColourName;
  /** Legend ink. */
  ink: string;
  rough: number;
  /** Underglow colour. */
  glow: string;
  /** Legend atlas pixels per unit at full quality. */
  ppu: number;
  dish?: number;
  tilt?: number;
}

export const CAST: readonly CapSpec[] = [
  { id: 'space', u: 6.25, h: 0.5, col: 'chalk', ink: HEX.graphite, rough: 0.66, glow: '#FFE7A8', ppu: 230, dish: 0.03 },
  { id: 'shift', u: 2.25, h: 0.6, col: 'graphite', ink: HEX.chalk, rough: 0.48, glow: '#8FD8C0', ppu: 280 },
  { id: 'enter', u: 2.25, h: 0.6, col: 'tomato', ink: HEX.chalk, rough: 0.62, glow: '#FF6A4D', ppu: 380 },
  { id: 'tab', u: 1.5, h: 0.6, col: 'mint', ink: HEX.graphite, rough: 0.66, glow: '#8FD8C0', ppu: 300 },
  { id: 'cmd', u: 1.25, h: 0.6, col: 'yolk', ink: HEX.graphite, rough: 0.64, glow: '#F6C12B', ppu: 300, tilt: -0.02 },
  { id: 'esc', u: 1, h: 0.6, col: 'chalk', ink: HEX.tomato, rough: 0.68, glow: '#FFE7A8', ppu: 300, tilt: 0.02 },
  { id: 'opt', u: 1.25, h: 0.6, col: 'graphite', ink: HEX.yolk, rough: 0.48, glow: '#F6C12B', ppu: 300 },
  { id: 'fn', u: 1, h: 0.6, col: 'cobalt', ink: HEX.chalk, rough: 0.62, glow: '#6F8BFF', ppu: 300 },
  { id: 'art', u: 1, h: 0.8, art: true, col: 'chalk', ink: HEX.graphite, rough: 0.07, glow: '#8FD8C0', ppu: 0 },
];

/** Cap footprint: depth is always 1u. */
export const capHalfWidth = (spec: CapSpec) => spec.u / 2 - 0.03;
export const CAP_HALF_DEPTH = 0.47;

/* ------------------------------------------------------------------ legends */
export type Icon = 'shift' | 'enter' | 'tab' | 'opt' | 'cmd';
export type SleeveKind = 'dash' | 'shop' | 'app' | 'site';

/** What is printed on a cap's top face in one layout. `null` is a blank key. */
export type Legend =
  | { k: 'brand'; al?: 'r' }
  | { k: 'key'; t: string; icon?: Icon }
  | { k: 'svc'; n: string; t: string[] }
  | { k: 'proj'; kind: SleeveKind; panel?: string }
  | { k: 'label'; t: string }
  | { k: 'num'; t: string }
  | { k: 'send' }
  | null;

/** Layout order: hero, services, work, pricing, team, contact. */
export const LAYOUT_NAMES = ['cairn', 'cluster', 'shelf', 'plates', 'row', 'enter'] as const;
export type LayoutName = (typeof LAYOUT_NAMES)[number];

/** Station key -> layout it shows. */
export const LAYOUT_OF_STATION: Record<string, LayoutName> = {
  hero: 'cairn',
  services: 'cluster',
  work: 'shelf',
  pricing: 'plates',
  team: 'row',
  contact: 'enter',
};

const key = (t: string, icon?: Icon): Legend => (icon ? { k: 'key', t, icon } : { k: 'key', t });
const svc = (n: string, ...t: string[]): Legend => ({ k: 'svc', n, t });

/** Static legends per cap for [cairn, cluster, shelf, plates, row, enter]; shelf and row are overridden by data. */
export const BASE_LEGENDS: readonly (readonly Legend[])[] = [
  [{ k: 'brand', al: 'r' }, { k: 'brand' }, { k: 'label', t: 'work' }, { k: 'brand' }, null, { k: 'brand' }],
  [key('shift', 'shift'), svc('01', 'Web apps'), key('shift', 'shift'), key('shift', 'shift'), key('shift', 'shift'), key('shift', 'shift')],
  [key('enter', 'enter'), svc('03', 'Custom software'), key('enter', 'enter'), key('enter', 'enter'), key('enter', 'enter'), { k: 'send' }],
  [key('tab', 'tab'), svc('02', 'SaaS'), key('tab', 'tab'), key('tab', 'tab'), key('tab', 'tab'), key('tab', 'tab')],
  [key('cmd', 'cmd'), svc('04', 'Mobile', 'apps'), key('cmd', 'cmd'), key('cmd', 'cmd'), key('cmd', 'cmd'), key('cmd', 'cmd')],
  [key('esc'), svc('05', 'UI/UX', 'design'), key('esc'), key('esc'), key('esc'), key('esc')],
  [key('opt', 'opt'), svc('06', 'Cloud &', 'DevOps'), key('opt', 'opt'), key('opt', 'opt'), key('opt', 'opt'), key('opt', 'opt')],
  [key('fn'), key('fn'), key('fn'), key('fn'), key('fn'), key('fn')],
  [null, null, null, null, null, null],
];

/** Cap carrying service i (inverse of SERVICE_OF_CAP). */
export const CAP_OF_SERVICE = [SHIFT, TAB, ENTER, CMD, ESC, OPT] as const;

/** Real keyboard code -> cap pressed. Any other key presses a cap picked from its code. */
export const CODE_CAP: Record<string, number> = {
  Space: SPACE,
  ShiftLeft: SHIFT,
  ShiftRight: SHIFT,
  Enter: ENTER,
  NumpadEnter: ENTER,
  Tab: TAB,
  MetaLeft: CMD,
  MetaRight: CMD,
  ControlLeft: CMD,
  ControlRight: CMD,
  Escape: ESC,
  AltLeft: OPT,
  AltRight: OPT,
  CapsLock: FN,
};

/** Hero attention only visits stacked caps; the bar and the loose fn stay unlit. */
export const CAIRN_ORDER = [SHIFT, OPT, TAB, CMD, ESC, ART, ENTER] as const;
