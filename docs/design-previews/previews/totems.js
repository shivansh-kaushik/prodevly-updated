// Glazed Component Totems — ProDevly home preview.
// Fifteen glazed earthenware components on white laminate plinths. The same
// pieces lift apart and re-stack into a different totem for every chapter.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const meta = {
  id: 'totems',
  title: 'Glazed Component Totems',
  stage: { background: '#CDE8D9', fov: 30, exposure: 1, shadows: true },
  sections: [
    { key: 'hero', label: 'Hero', at: 0 },
    { key: 'services', label: 'Services', at: 0.2 },
    { key: 'projects', label: 'Projects', at: 0.4 },
    { key: 'pricing', label: 'Pricing', at: 0.6 },
    { key: 'team', label: 'Developers', at: 0.8 },
    { key: 'contact', label: 'Contact', at: 1 },
  ],
  fonts: ['Strichpunkt+Sans:wdth,wght@100..200,400..900', 'Fragment+Mono'],
};

/* ------------------------------------------------------------------ */
/* Palette (sRGB hex, Sottsass / Bacterio laminate)                    */
/* ------------------------------------------------------------------ */
const HEX = {
  mint: '#CDE8D9',
  ink: '#141414',
  cobalt: '#2340C8',
  yolk: '#F6C12B',
  salmon: '#F2917F',
  tomato: '#E5362C',
  white: '#FAFAF7',
  glazeWhite: '#F2EFE7',
  glazeBlack: '#171717',
  gold: '#F0C35A',
};
// Field per section and the tinted shadow that sits on it.
const FIELDS = ['mint', 'white', 'cobalt', 'yolk', 'salmon', 'ink'];
const SHADOW_TINT = ['#1d4d3a', '#2b2f3a', '#07124a', '#6b3f00', '#6e231a', '#000000'];
const SHADOW_OPACITY = [0.34, 0.26, 0.42, 0.3, 0.32, 0.5];
const DARK_FIELD = [false, false, true, false, false, true];
const AT = [0, 0.2, 0.4, 0.6, 0.8, 1];
const PLINTH_H = 4;

export const css = `
.totems-root{position:absolute;inset:0;color:#141414;font-family:'Strichpunkt Sans',system-ui,sans-serif;font-stretch:100%;font-weight:450;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal}
.totems-root *{box-sizing:border-box;margin:0;padding:0}
.totems-root :where(h1,h2,p,b,span,em,label,i,footer,header,section,div){color:inherit;font-family:inherit;max-width:none;background:none;border:0}
.totems-nav{position:absolute;left:4cqw;right:4cqw;top:3.4cqh;display:flex;align-items:center;gap:2.5cqw;z-index:4;color:#141414}
.totems-nav.totems-on-dark{color:#FAFAF7}
.totems-logo{font-weight:820;font-stretch:150%;font-size:1.62cqw;letter-spacing:-.01em;margin-right:auto;display:flex;align-items:center;gap:.5cqw}
.totems-logo-mark{display:inline-block;width:1.05cqw;height:1.05cqw;border-radius:50%;background:#E5362C;box-shadow:inset -.18cqw -.18cqw 0 rgba(0,0,0,.18)}
.totems-link{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.9cqw;letter-spacing:.01em}
.totems-navcta{font-weight:640;font-size:.95cqw;padding:.62cqw .95cqw;border:.12cqw solid currentColor;border-radius:.25cqw}
.totems-menu{display:none;font-family:'Fragment Mono',ui-monospace,monospace}
.totems-sec{position:absolute;inset:0;opacity:0;will-change:opacity,transform}
.totems-on-dark-sec{color:#FAFAF7}
.totems-eyebrow{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.92cqw;letter-spacing:.02em;display:flex;gap:1.1cqw;align-items:center;margin-bottom:2.2cqh}
.totems-eyebrow i{font-style:normal;display:inline-block;width:2.4cqw;height:.12cqw;background:currentColor}
.totems-h1{font-family:'Strichpunkt Sans',system-ui,sans-serif;font-weight:820;font-stretch:178%;font-size:3.55cqw;line-height:1.01;letter-spacing:-.014em}
.totems-h2{font-family:'Strichpunkt Sans',system-ui,sans-serif;font-weight:820;font-stretch:178%;font-size:3.05cqw;line-height:1.02;letter-spacing:-.014em}
.totems-p{font-family:'Strichpunkt Sans',system-ui,sans-serif;font-size:1.22cqw;line-height:1.48;max-width:30cqw;margin-top:2.6cqh}
.totems-also{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;line-height:1.6;margin-top:2.4cqh;max-width:30cqw}
.totems-ctas{display:flex;align-items:center;gap:2cqw;margin-top:4cqh}
.totems-btn{display:inline-flex;align-items:center;gap:.9cqw;background:#141414;color:#FAFAF7;font-weight:640;font-size:1.06cqw;padding:1.05cqw 1.45cqw;border-radius:.25cqw;white-space:nowrap}
.totems-btn i{font-style:normal;font-family:'Fragment Mono',ui-monospace,monospace}
.totems-btn-y{background:#F6C12B;color:#141414}
.totems-textlink{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.9cqw;border-bottom:.1cqw solid currentColor;padding-bottom:.2cqh}
.totems-label{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.88cqw;line-height:1.5}
.totems-label b{display:block;font-family:'Strichpunkt Sans',system-ui,sans-serif;font-weight:700;font-stretch:118%;font-size:1cqw;line-height:1.25;margin-bottom:.35cqh}
.totems-hero-copy{position:absolute;left:4cqw;top:21cqh;width:47cqw}
.totems-hero-label{position:absolute;left:4cqw;bottom:6.5cqh;width:24cqw;padding-left:1cqw;border-left:.12cqw solid currentColor}
.totems-copy{position:absolute;left:4cqw;top:17cqh;width:36cqw}
.totems-copy-top{top:15cqh}
.totems-tag{position:absolute;left:0;top:0;width:15cqw;margin-left:-7.5cqw;text-align:center;will-change:transform}
.totems-tag b{font-stretch:112%}
.totems-tag-l{text-align:left;margin-left:0;width:14cqw;padding-left:.9cqw;border-left:.12cqw solid currentColor}
.totems-card{display:none}
.totems-form{position:absolute;left:4cqw;top:41cqh;width:34cqw;background:#FAFAF7;color:#141414;padding:2.2cqw;display:grid;gap:1.25cqw;border-radius:.3cqw}
.totems-field{display:grid;gap:.5cqh}
.totems-field span{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.78cqw;letter-spacing:.02em}
.totems-field em{display:block;height:3.6cqh;border-bottom:.12cqw solid #141414;font-style:normal;font-size:1cqw;color:#6b6b66;line-height:3.4cqh}
.totems-form .totems-btn{justify-self:start;margin-top:.6cqh}
.totems-foot{position:absolute;left:4cqw;width:52cqw;bottom:3.4cqh;display:flex;align-items:baseline;gap:2.4cqw;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.92cqw;color:#FAFAF7;opacity:1;padding-top:1.6cqh;border-top:.08cqw solid rgba(250,250,247,.34)}
.totems-foot span:first-child{font-family:'Strichpunkt Sans',system-ui,sans-serif;font-weight:800;font-stretch:150%;font-size:1.02cqw;opacity:1}
.totems-contact-copy{top:15cqh}
.totems-copy-top .totems-p{max-width:25cqw}
.totems-root:not(.totems-ph) .totems-sec[data-s="4"] .totems-copy{left:auto;right:4cqw;width:31cqw}
.totems-root:not(.totems-ph) .totems-sec[data-s="4"] .totems-p{max-width:27cqw}
.totems-card-contact{display:none}
.totems-ph .totems-card.totems-card-contact{display:block;padding:4.6cqw 4.6cqw 4.4cqw}
.totems-ph .totems-card-contact .totems-label b{font-size:4.2cqw;font-stretch:125%;font-weight:760;margin-bottom:1.2cqw}
.totems-ph .totems-card-contact .totems-btn{margin-top:3.6cqw}
/* ---------- phone ---------- */
.totems-ph .totems-nav{left:6cqw;right:6cqw;top:3.2cqh}
.totems-ph .totems-logo{font-size:5.2cqw;gap:1.5cqw}
.totems-ph .totems-logo-mark{width:3.2cqw;height:3.2cqw}
.totems-ph .totems-link,.totems-ph .totems-navcta{display:none}
.totems-ph .totems-menu{display:block;font-size:3.4cqw}
.totems-ph .totems-eyebrow{font-size:3.1cqw;margin-bottom:1.4cqh;gap:2.6cqw}
.totems-ph .totems-eyebrow i{width:6cqw;height:.35cqw}
.totems-ph .totems-h1{font-size:7.3cqw;font-stretch:150%;line-height:1.03}
.totems-ph .totems-h2{font-size:7.6cqw;font-stretch:150%}
.totems-ph .totems-p,.totems-ph .totems-also,.totems-ph .totems-ctas,.totems-ph .totems-hero-label,.totems-ph .totems-tag{display:none}
.totems-ph .totems-hero-copy{left:6cqw;right:6cqw;width:auto;top:10.5cqh}
.totems-ph .totems-copy{left:6cqw;right:6cqw;width:auto;top:10cqh}
.totems-ph .totems-card{display:block;position:absolute;left:4cqw;right:4cqw;bottom:2.4cqh;background:#FAFAF7;color:#141414;padding:4.4cqw 4.6cqw;border-radius:1cqw}
.totems-ph .totems-card .totems-label{font-size:3cqw}
.totems-ph .totems-card .totems-label b{font-size:3.6cqw}
.totems-ph .totems-card .totems-btn{display:flex;justify-content:space-between;font-size:3.7cqw;padding:3.4cqw 4cqw;margin-top:3cqw;border-radius:.8cqw}
.totems-ph .totems-card-row{display:flex;align-items:center;justify-content:space-between;gap:3cqw;padding:3.6cqw 3.6cqw 3.6cqw 4.6cqw}
.totems-ph .totems-card-row .totems-label{font-size:2.75cqw;line-height:1.4}
.totems-ph .totems-card-row .totems-label b{font-size:3.3cqw}
.totems-ph .totems-card.totems-card-row .totems-btn{margin-top:0;gap:2.4cqw;font-size:3.5cqw;padding:3.4cqw 3.8cqw}
.totems-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:3cqw}
.totems-cols .totems-label{font-size:2.6cqw;line-height:1.45}
.totems-ph .totems-cols .totems-label b{font-size:3.1cqw;font-stretch:105%;margin-bottom:.6cqw}
.totems-card-note{font-family:'Fragment Mono',ui-monospace,monospace;font-size:2.6cqw;line-height:1.45;margin-top:3cqw;padding-top:2.6cqw;border-top:.3cqw solid #141414}
.totems-ph .totems-form{display:none}
.totems-ph .totems-foot{display:none}
.totems-ph .totems-contact-copy{top:10cqh}
`;

/* ------------------------------------------------------------------ */
/* Pieces. Heights are in metres-ish world units, origin at centre.    */
/* ------------------------------------------------------------------ */
const PIECES = [
  { key: 'drumA', kind: 'drum', r: 0.72, h: 0.58, b: 0.08, col: 'cobalt', bands: [[0.15, 0.22, 'glazeWhite'], [0.78, 0.85, 'glazeWhite']], mark: 'A', markInk: '#F2EFE7', rough: 0.44 },
  { key: 'discB', kind: 'drum', r: 0.82, h: 0.11, b: 0.045, col: 'glazeBlack', rough: 0.32 },
  { key: 'spoolC', kind: 'spool', r: 0.55, w: 0.33, h: 0.56, b: 0.055, col: 'salmon', bands: [[0.0, 0.1, 'tomato'], [0.9, 1.0, 'tomato']], rough: 0.48 },
  { key: 'cubeD', kind: 'box', w: 0.88, h: 0.64, d: 0.88, rad: 0.085, col: 'yolk', ry: Math.PI / 4, mark: 'L', markInk: '#171717', rough: 0.46 },
  { key: 'discE', kind: 'drum', r: 0.65, h: 0.095, b: 0.042, col: 'glazeWhite', rough: 0.5 },
  { key: 'frustF', kind: 'frustum', r0: 0.56, r1: 0.26, h: 0.48, b: 0.055, col: 'tomato', rough: 0.45 },
  { key: 'neckG', kind: 'drum', r: 0.24, h: 0.22, b: 0.045, col: 'glazeBlack', rough: 0.32 },
  { key: 'coneH', kind: 'cone', r: 0.6, h: 0.62, b: 0.055, col: 'cobalt', bands: [[0.0, 0.1, 'glazeWhite']], rough: 0.42 },
  { key: 'discI', kind: 'drum', r: 0.67, h: 0.09, b: 0.04, col: 'yolk', rough: 0.46 },
  { key: 'capJ', kind: 'capsule', r: 0.33, h: 0.9, col: 'glazeWhite', bands: [[0.17, 0.235, 'glazeBlack'], [0.765, 0.83, 'glazeBlack']], mark: 'S', markInk: '#E5362C', rough: 0.5 },
  { key: 'discK', kind: 'drum', r: 0.53, h: 0.085, b: 0.038, col: 'tomato', rough: 0.45 },
  { key: 'neckL', kind: 'drum', r: 0.21, h: 0.2, b: 0.045, col: 'salmon', rough: 0.48 },
  { key: 'bowlM', kind: 'bowl', r: 0.52, h: 0.4, col: 'glazeBlack', bands: [[0.86, 1.0, 'glazeWhite']], rough: 0.32 },
  { key: 'ringN', kind: 'torus', R: 0.37, tube: 0.115, col: 'cobalt', rough: 0.42 },
  { key: 'ballO', kind: 'sphere', r: 0.31, col: 'gold', gold: true },
];
const ID = Object.fromEntries(PIECES.map((p, i) => [p.key, i]));
PIECES.forEach((p) => {
  if (p.kind === 'torus') p.h = p.tube * 2;
  if (p.kind === 'sphere') p.h = p.r * 2;
});

const HERO_ORDER = ['drumA', 'discB', 'spoolC', 'cubeD', 'discE', 'frustF', 'neckG', 'coneH', 'discI', 'capJ', 'discK', 'neckL', 'bowlM', 'ringN', 'ballO'];

/* ------------------------------------------------------------------ */
/* Arrangements: one per section, desktop and phone variants.          */
/* stack: {x, z, top (plinth top), ps (plinth footprint), rot, s, ids,  */
/*         flip: [keys turned upside down], face: [keys turned to cam]} */
/* ------------------------------------------------------------------ */
const FLIP_HERO = ['coneH'];
const DESK = [
  // 0 hero
  { ceil: 6.45, ceilP: 6.4, stacks: [{ x: 0, z: 0, top: 0.92, ps: 1.85, pr: 0.42, rot: 0, s: 1, ids: HERO_ORDER, flip: FLIP_HERO }] },
  // 1 services: same parts, three products
  {
    stacks: [
      { x: -2.9, z: 0, top: 0.78, ps: 1.6, rot: 0.25, s: 1, ids: ['spoolC', 'discB', 'cubeD', 'neckG', 'coneH'] },
      { x: 0, z: 0, top: 0.78, ps: 1.6, rot: -0.2, s: 1, ids: ['drumA', 'discI', 'frustF', 'ringN', 'ballO'] },
      { x: 2.9, z: 0, top: 0.78, ps: 1.6, rot: 0.1, s: 1, ids: ['discE', 'capJ', 'discK', 'neckL', 'bowlM'] },
    ],
  },
  // 2 projects: a gallery row
  {
    ceil: 3.45,
    stacks: [
      { x: -2.7, z: -1.0, top: 0.82, ps: 1.32, rot: 0.6, s: 0.96, ids: ['drumA', 'discK', 'bowlM', 'ringN', 'ballO'] },
      { x: 0, z: 0, top: 0.82, ps: 1.32, rot: -0.3, s: 0.96, ids: ['cubeD', 'discB', 'spoolC', 'neckG', 'coneH'] },
      { x: 3.3, z: 0, top: 0.82, ps: 1.32, rot: 0.2, s: 0.96, ids: ['frustF', 'discI', 'capJ', 'discE', 'neckL'] },
    ],
  },
  // 3 pricing: 3 / 5 / 7 pieces on a staircase of plinths rising toward the camera
  {
    ceil: 4.1,
    stacks: [
      { x: -2.9, z: -1.6, top: 0.5, ps: 1.5, rot: 0.2, s: 1, ids: ['spoolC', 'ringN', 'ballO'] },
      { x: 0, z: 0, top: 1.2, ps: 1.6, rot: -0.15, s: 1, ids: ['drumA', 'discB', 'frustF', 'neckG', 'coneH'] },
      { x: 2.9, z: 1.6, top: 2.0, ps: 1.5, rot: 0.1, s: 1, ids: ['cubeD', 'discE', 'capJ', 'discI', 'neckL', 'bowlM', 'discK'] },
    ],
  },
  // 4 team: single signed pieces on a diagonal (macro), the rest sink into the floor
  {
    stacks: [
      { x: 1.45, z: -2.5, top: 0.85, ps: 2.15, rot: 0, s: 1.35, ids: ['drumA'], face: true },
      { x: -0.55, z: -0.2, top: 1.15, ps: 1.65, rot: 0, s: 1.5, ids: ['cubeD'], face: true },
      { x: -2.5, z: 1.8, top: 0.85, ps: 1.25, rot: 0, s: 1.7, ids: ['capJ'], face: true },
    ],
    out: true,
  },
  // 5 contact: the original totem, top slot empty, the gold piece hovering
  { ceil: 7.1, stacks: [{ x: 0, z: 0, top: 0.92, ps: 1.85, pr: 0.42, rot: 0, s: 1, ids: HERO_ORDER, flip: FLIP_HERO, hover: 'ballO' }] },
];
const PHONE = [
  { stacks: [{ x: 0, z: 0, top: 0.62, ps: 1.85, pr: 0.42, rot: 0, s: 1, ids: HERO_ORDER, flip: FLIP_HERO }] },
  {
    stacks: [
      { x: -1.32, z: -0.3, top: 0.6, ps: 1.1, rot: 0.25, s: 0.72, ids: ['spoolC', 'discB', 'cubeD', 'neckG', 'coneH'] },
      { x: 0, z: 0.5, top: 0.6, ps: 1.1, rot: -0.2, s: 0.72, ids: ['drumA', 'discI', 'frustF', 'ringN', 'ballO'] },
      { x: 1.32, z: -0.3, top: 0.6, ps: 1.1, rot: 0.1, s: 0.72, ids: ['discE', 'capJ', 'discK', 'neckL', 'bowlM'] },
    ],
  },
  {
    stacks: [
      { x: 0.95, z: -4.6, top: 0.8, ps: 1.24, rot: 0.6, s: 0.9, ids: ['drumA', 'discK', 'bowlM', 'ringN', 'ballO'] },
      { x: -0.85, z: -1.7, top: 0.8, ps: 1.24, rot: -0.3, s: 0.9, ids: ['cubeD', 'discB', 'spoolC', 'neckG', 'coneH'] },
      { x: 0.75, z: 1.2, top: 0.8, ps: 1.24, rot: 0.2, s: 0.9, ids: ['frustF', 'discI', 'capJ', 'discE', 'neckL'] },
    ],
  },
  {
    stacks: [
      { x: -1.2, z: -0.5, top: 0.4, ps: 1.0, rot: 0.2, s: 0.72, ids: ['spoolC', 'ringN', 'ballO'] },
      { x: 0, z: 0, top: 0.8, ps: 1.08, rot: -0.15, s: 0.72, ids: ['drumA', 'discB', 'frustF', 'neckG', 'coneH'] },
      { x: 1.2, z: 0.5, top: 1.2, ps: 1.0, rot: 0.1, s: 0.72, ids: ['cubeD', 'discE', 'capJ', 'discI', 'neckL', 'bowlM', 'discK'] },
    ],
  },
  {
    stacks: [
      { x: -0.95, z: -3.3, top: 0.95, ps: 1.7, rot: 0, s: 1.05, ids: ['drumA'], face: true },
      { x: 1.0, z: -1.3, top: 0.95, ps: 1.3, rot: 0, s: 1.15, ids: ['cubeD'], face: true },
      { x: 0.25, z: 2.3, top: 0.95, ps: 1.0, rot: 0, s: 1.25, ids: ['capJ'], face: true },
    ],
    out: true,
    parkX: 1.8,
  },
  { stacks: [{ x: 0, z: 0, top: 0.62, ps: 1.85, pr: 0.42, rot: 0, s: 1, ids: HERO_ORDER, flip: FLIP_HERO, hover: 'ballO' }] },
];

/* Camera keyframes: position, target, horizontal subject shift (fraction of width). */
const CAM_DESK = [
  { at: 0, px: 3.2, py: 1.8, pz: 16.9, tx: 0, ty: 3.2, tz: 0, fx: 0.2 },
  { at: 0.2, px: 0.4, py: 2.8, pz: 16.4, tx: 0, ty: 1.9, tz: 0, fx: 0.17 },
  { at: 0.33, px: -9.8, py: 2.4, pz: 9.4, tx: -1.6, ty: 1.55, tz: 0, fx: 0.12 },
  { at: 0.47, px: -5.6, py: 2.6, pz: 10.6, tx: 1.8, ty: 1.55, tz: 0, fx: 0.12 },
  { at: 0.6, px: 6.0, py: 1.5, pz: 15.5, tx: 0.3, ty: 2.25, tz: 0, fx: 0.1 },
  { at: 0.8, px: 0.2, py: 2.7, pz: 10.4, tx: -0.78, ty: 1.4, tz: 0, fx: -0.12 },
  // the contact camera settles before the column re-forms, so the rising pieces never cross the nav
  { at: 0.93, px: 1.6, py: 3.2, pz: 17.4, tx: 0, ty: 3.55, tz: 0, fx: 0.21 },
  { at: 1, px: 1.6, py: 3.2, pz: 17.4, tx: 0, ty: 3.55, tz: 0, fx: 0.21 },
];
const CAM_PHONE = [
  { at: 0, px: 1.6, py: 2.6, pz: 22.0, tx: 0, ty: 3.68, tz: 0, fx: 0 },
  { at: 0.2, px: 0.2, py: 3.8, pz: 16.8, tx: 0, ty: 1.7, tz: 0, fx: 0 },
  { at: 0.33, px: -2.6, py: 6.6, pz: 13.8, tx: 0.3, ty: 1.15, tz: -1.4, fx: 0 },
  { at: 0.47, px: -0.7, py: 7.0, pz: 12.2, tx: 0.4, ty: 1.15, tz: -1.6, fx: 0 },
  { at: 0.6, px: 0.2, py: 3.4, pz: 16.8, tx: 0.12, ty: 1.95, tz: 0, fx: 0 },
  { at: 0.8, px: 0.3, py: 6.8, pz: 13.6, tx: 0, ty: 0.85, tz: -0.6, fx: 0 },
  { at: 0.93, px: 0.6, py: 3.0, pz: 24.5, tx: 0, ty: 3.15, tz: 0, fx: 0 },
  { at: 1, px: 0.6, py: 3.0, pz: 24.5, tx: 0, ty: 3.15, tz: 0, fx: 0 },
];

/* ------------------------------------------------------------------ */
/* Module-scope scratch (no allocation in update)                      */
/* ------------------------------------------------------------------ */
const CAM = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fx: 0 };
const CAM_KEYS = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fx'];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hexToSRGB(hex, out) {
  const n = parseInt(hex.slice(1), 16);
  out.x = ((n >> 16) & 255) / 255;
  out.y = ((n >> 8) & 255) / 255;
  out.z = (n & 255) / 255;
  return out;
}

export function create(ctx) {
  const { THREE, scene, camera, renderer, overlay, helpers } = ctx;
  const { band, window01, clamp, lerp } = helpers;
  const reduced = ctx.reducedMotion;
  const disposables = [];
  const keep = (o) => (disposables.push(o), o);

  const _v = new THREE.Vector3();
  const _c1 = new THREE.Color();
  const _c2 = new THREE.Color();
  const _vA = new THREE.Vector3();
  const _vB = new THREE.Vector3();

  /* ---------------- canvas textures ---------------- */
  function canvas(w, h = w) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function squiggleTile(size, count, lw, seed, lenMin, lenMax) {
    const cv = canvas(size);
    const g = cv.getContext('2d');
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = lw;
    const rnd = mulberry32(seed);
    for (let n = 0; n < count; n++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const a = rnd() * Math.PI * 2;
      const L = lenMin + rnd() * (lenMax - lenMin);
      const A = L * (0.12 + rnd() * 0.1);
      const waves = 1.2 + rnd() * 1.6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          g.beginPath();
          for (let k = 0; k <= 28; k++) {
            const t = k / 28;
            const u = (t - 0.5) * L;
            const v = Math.sin(t * waves * Math.PI * 2) * A;
            const px = x + ox * size + ca * u - sa * v;
            const py = y + oy * size + sa * u + ca * v;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.stroke();
        }
    }
    const t = keep(new THREE.CanvasTexture(cv));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    return t;
  }
  function roughnessTile() {
    const cv = canvas(256);
    const g = cv.getContext('2d');
    g.fillStyle = 'rgb(232,232,232)';
    g.fillRect(0, 0, 256, 256);
    const rnd = mulberry32(7);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * 256;
      const y = rnd() * 256;
      const r = 8 + rnd() * 34;
      const v = Math.round(185 + rnd() * 70);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = keep(new THREE.CanvasTexture(cv));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.repeat.set(3, 2);
    return t;
  }
  function radialTile(inner, outer) {
    const cv = canvas(128);
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(255,255,255,${inner})`);
    gr.addColorStop(0.45, `rgba(255,255,255,${inner * 0.62})`);
    gr.addColorStop(1, `rgba(255,255,255,${outer})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = keep(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function letterTile(ch) {
    const cv = canvas(256);
    const t = keep(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.NoColorSpace;
    const draw = () => {
      const g = cv.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 256);
      g.filter = 'blur(2.5px)';
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '800 210px "Strichpunkt Sans", system-ui, sans-serif';
      g.fillText(ch, 128, 140);
      g.filter = 'none';
      t.needsUpdate = true;
    };
    draw();
    document.fonts?.load?.('800 210px "Strichpunkt Sans"').then(draw, () => {});
    return t;
  }

  // Services wall: one sparse Bacterio board (no tiling), with a black frame edge.
  function wallTile(w, h, count, lw, seed) {
    const cv = canvas(w, h);
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#141414';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = lw;
    const rnd = mulberry32(seed);
    // jittered grid keeps the scatter sparse and even, never clumped
    const cols = Math.round(Math.sqrt((count * w) / h));
    const rows = Math.ceil(count / cols);
    for (let n = 0; n < cols * rows; n++) {
      const cx = ((n % cols) + 0.2 + rnd() * 0.6) * (w / cols);
      const cy = (Math.floor(n / cols) + 0.2 + rnd() * 0.6) * (h / rows);
      const a = rnd() * Math.PI * 2;
      const L = (0.05 + rnd() * 0.035) * w;
      const A = L * (0.12 + rnd() * 0.08);
      const waves = 1.3 + rnd() * 1.2;
      g.beginPath();
      for (let k = 0; k <= 32; k++) {
        const t = k / 32;
        const uu = (t - 0.5) * L;
        const vv = Math.sin(t * waves * Math.PI * 2) * A;
        const px = cx + Math.cos(a) * uu - Math.sin(a) * vv;
        const py = cy + Math.sin(a) * uu + Math.cos(a) * vv;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    const fr = Math.round(h * 0.014);
    g.fillStyle = '#141414';
    g.fillRect(0, 0, w, fr);
    g.fillRect(0, 0, fr, h);
    g.fillRect(w - fr, 0, fr, h);
    const t = keep(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  const wallTex = wallTile(1800, 840, 22, 6, 11);
  const plinthPattern = squiggleTile(512, 16, 5.5, 23, 48, 60);
  const roughTex = roughnessTile();
  const blobTex = radialTile(0.95, 0);
  const blankTex = keep(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  blankTex.needsUpdate = true;

  /* ---------------- studio environment (softboxes, not the default room) ---------------- */
  const prevEnv = scene.environment;
  let envForGold = null;
  const prevEnvIntensity = scene.environmentIntensity;
  {
    const envScene = new THREE.Scene();
    const geos = [];
    const mats = [];
    const wallM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.4, 0.41), side: THREE.BackSide });
    const room = new THREE.BoxGeometry(24, 14, 24);
    envScene.add(new THREE.Mesh(room, wallM));
    geos.push(room);
    mats.push(wallM);
    const floorM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.16, 0.16) });
    const floorG = new THREE.PlaneGeometry(24, 24);
    const floor = new THREE.Mesh(floorG, floorM);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -6.8;
    envScene.add(floor);
    geos.push(floorG);
    mats.push(floorM);
    const panel = (w, h, x, y, z, intensity, tint = [1, 1, 1]) => {
      const g = new THREE.PlaneGeometry(w, h);
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
      geos.push(g);
      mats.push(m);
    };
    panel(9, 6, -7.5, 6, 6.5, 7.5, [1, 0.98, 0.95]); // big key softbox, top-left front
    panel(1.3, 10, 9.5, 1.5, -5, 5.0, [0.92, 0.96, 1]); // rim strip, back right
    panel(1.0, 9, -9.5, 0.5, -6, 3.2); // rim strip, back left
    panel(14, 1.2, 0, 6.8, 0, 2.2); // top strip
    panel(6, 3, 6, 0.5, 9, 1.4, [1, 0.97, 0.92]); // low front fill card
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.035);
    keep(rt);
    scene.environment = rt.texture;
    envForGold = rt.texture;
    scene.environmentIntensity = 0.95;
    pmrem.dispose();
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }

  /* ---------------- background field: flat colour, squiggle wipe, grain ---------------- */
  const bgUniforms = {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uW: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uLine: { value: new THREE.Vector3(0.08, 0.08, 0.08) },
    uHorizon: { value: 0.6 },
    uSpot: { value: new THREE.Vector4(0.7, 0.5, 0.0, 0.35) },
  };
  const bgMat = keep(
    new THREE.ShaderMaterial({
      uniforms: bgUniforms,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `
        uniform vec3 uA; uniform vec3 uB; uniform float uW;
        uniform vec2 uRes; uniform vec3 uLine; uniform float uHorizon; uniform vec4 uSpot;
        varying vec2 vUv;
        void main(){
          float asp = uRes.x / uRes.y;
          float edge = mix(-0.14, 1.14, uW) + 0.028 * sin(vUv.x * asp * 7.0 + 1.3) + 0.012 * sin(vUv.x * asp * 19.0 + 0.4);
          float d = edge - vUv.y;
          float aa = fwidth(d) * 1.2;
          float m = smoothstep(-aa, aa, d);
          vec3 col = mix(uA, uB, m);
          // gallery floor: a soft sweep below the horizon
          float fl = smoothstep(uHorizon + 0.02, uHorizon - 0.34, vUv.y);
          col *= 1.0 - 0.045 * fl;
          // spotlight wash on dark walls
          vec2 sd = (vUv - uSpot.xy) * vec2(asp, 1.0);
          col += vec3(0.95, 0.93, 0.9) * uSpot.z * exp(-dot(sd, sd) / (uSpot.w * uSpot.w));
          float lineW = 3.0 / uRes.y;
          float ln = 1.0 - smoothstep(lineW * 0.5, lineW * 0.5 + aa, abs(d));
          ln *= step(0.002, uW) * step(uW, 0.998);
          col = mix(col, uLine, ln);
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          col += (n - 0.5) * 0.014;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  const bgGeo = keep(new THREE.PlaneGeometry(2, 2));
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  // Floor: depth-only mask (hides sunk plinths) + tinted shadow catcher.
  const floorGeo = keep(new THREE.PlaneGeometry(120, 120));
  const maskMat = keep(new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  const mask = new THREE.Mesh(floorGeo, maskMat);
  mask.rotation.x = -Math.PI / 2;
  mask.renderOrder = -5;
  scene.add(mask);
  const shadowMat = keep(new THREE.ShadowMaterial({ color: new THREE.Color(HEX.ink), opacity: 0.3, depthWrite: false }));
  const shadowPlane = new THREE.Mesh(floorGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.002;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  /* ---------------- lights ---------------- */
  const hemi = new THREE.HemisphereLight('#ffffff', HEX.mint, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff4e6', 2.5);
  key.position.set(-4.2, 11, 5.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 8, bottom: -4.5, near: 2, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4.5;
  key.target.position.set(0, 1.6, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#e4ecff', 1.25);
  rim.position.set(6, 5, -8);
  scene.add(rim);
  const glow = new THREE.PointLight(HEX.yolk, 0, 5, 1.6);
  scene.add(glow);

  /* ---------------- materials ---------------- */
  const GLAZE_VERT_HEAD = '#include <common>\nattribute float bisque;\nvarying vec3 vObjPos;\nvarying vec3 vObjNrm;\nvarying float vBisque;';
  const GLAZE_VERT_BODY = '#include <begin_vertex>\nvObjPos = position;\nvObjNrm = normal;\nvBisque = bisque;';
  const GLAZE_FRAG_HEAD = `#include <common>
uniform float uMark; uniform sampler2D uMarkTex; uniform float uMarkMode; uniform vec4 uMarkRect; uniform vec3 uMarkInk;
varying vec3 vObjPos; varying vec3 vObjNrm; varying float vBisque;
float markAt(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture2D(uMarkTex, clamp(uv, 0.0, 1.0)).r * inside;
}`;
  // Incised maker's mark: ink fills the cut, the wall facing the key light falls into
  // shadow, the far wall catches a sliver of light. Unglazed bisque at every foot.
  const GLAZE_FRAG_COLOR = `#include <color_fragment>
float mk = 0.0;
{
  vec2 muv;
  float faceOk = 1.0;
  if (uMarkMode < 0.5) {
    float ang = atan(vObjPos.x, vObjPos.z);
    muv = vec2(ang / uMarkRect.z * 0.5 + 0.5, (vObjPos.y - uMarkRect.x) / uMarkRect.y * 0.5 + 0.5);
  } else {
    muv = vec2(vObjPos.x / uMarkRect.z * 0.5 + 0.5, (vObjPos.y - uMarkRect.x) / uMarkRect.y * 0.5 + 0.5);
    faceOk = smoothstep(0.7, 0.92, vObjNrm.z);
  }
  float gate = faceOk * uMark;
  mk = markAt(muv) * gate;
  float mkL = markAt(muv + vec2(-0.03, 0.042)) * gate;
  float mkD = markAt(muv + vec2(0.03, -0.042)) * gate;
  diffuseColor.rgb = mix(diffuseColor.rgb, uMarkInk, smoothstep(0.25, 0.75, mk));
  diffuseColor.rgb *= 1.0 - 0.55 * clamp(mk - mkL, 0.0, 1.0);
  diffuseColor.rgb += 0.16 * clamp(mk - mkD, 0.0, 1.0);
  diffuseColor.rgb += 0.12 * clamp(mkD - mk, 0.0, 1.0);
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.693, 0.651, 0.571), vBisque);`;
  const GLAZE_FRAG_ROUGH = '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, smoothstep(0.25, 0.75, mk));\nroughnessFactor = mix(roughnessFactor, 0.9, vBisque);';
  const GLAZE_FRAG_NORMAL = '#include <normal_fragment_maps>\n{ vec2 gm = vec2(dFdx(mk), dFdy(mk)); normal = normalize(normal - vec3(gm * 5.0, 0.0)); }';
  const GLAZE_FRAG_LIGHTS = '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - smoothstep(0.25, 0.75, mk)) * (1.0 - vBisque);\n#endif';

  function glaze(spec) {
    const isGold = !!spec.gold;
    const m = new THREE.MeshPhysicalMaterial({
      color: isGold ? HEX.gold : '#ffffff',
      vertexColors: true,
      roughness: isGold ? 0.14 : spec.rough ?? 0.45,
      metalness: isGold ? 1 : 0,
      clearcoat: isGold ? 0 : 1,
      clearcoatRoughness: 0.07,
      roughnessMap: roughTex,
      emissive: isGold ? HEX.yolk : '#000000',
      emissiveIntensity: 0,
    });
    m.userData.u = {
      uMark: { value: 0 },
      uMarkTex: { value: blankTex },
      uMarkMode: { value: 0 },
      uMarkRect: { value: new THREE.Vector4(0, 0.2, 0.6, 0) },
      uMarkInk: { value: new THREE.Color(spec.markInk ?? '#ffffff') },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', GLAZE_VERT_HEAD).replace('#include <begin_vertex>', GLAZE_VERT_BODY);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', GLAZE_FRAG_HEAD)
        .replace('#include <color_fragment>', GLAZE_FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', GLAZE_FRAG_ROUGH)
        .replace('#include <normal_fragment_maps>', GLAZE_FRAG_NORMAL)
        .replace('#include <lights_physical_fragment>', GLAZE_FRAG_LIGHTS);
    };
    m.customProgramCacheKey = () => 'totems-glaze';
    return keep(m);
  }

  function laminate() {
    const m = new THREE.MeshStandardMaterial({ color: HEX.white, roughness: 0.66, metalness: 0 });
    m.userData.u = { uPat: { value: plinthPattern }, uScale: { value: new THREE.Vector3(1, 1, 1) }, uTop: { value: PLINTH_H / 2 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uScale;\nvarying vec3 vLamPos;\nvarying vec3 vLamN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamPos = position * uScale;\nvLamN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uPat;\nuniform float uTop;\nvarying vec3 vLamPos;\nvarying vec3 vLamN;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec3 an = abs(normalize(vLamN));
  vec2 puv = an.y > 0.7 ? vLamPos.xz : (an.x > an.z ? vLamPos.zy : vLamPos.xy);
  float pat = texture2D(uPat, puv * 0.5 + 0.21).a * (1.0 - step(0.7, an.y));
  float side = 1.0 - smoothstep(0.5, 0.7, an.y);
  float bandY = step(uTop - 0.16, vLamPos.y) * step(vLamPos.y, uTop - 0.1);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), max(pat * 0.94, bandY * side));
}`,
        );
    };
    m.customProgramCacheKey = () => 'totems-laminate';
    return keep(m);
  }

  /* ---------------- geometry ---------------- */
  const SEG = 56;
  function fillet(pts, step = 0.014, fseg = 7) {
    const corners = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [r, y, rad = 0] = pts[i];
      if (i === 0 || i === n - 1 || rad <= 0) {
        corners.push({ s: [r, y], e: [r, y], p: [r, y], round: false });
        continue;
      }
      const [ar, ay] = pts[i - 1];
      const [br, by] = pts[i + 1];
      const la = Math.hypot(ar - r, ay - y);
      const lb = Math.hypot(br - r, by - y);
      const t1 = Math.min(rad, la * 0.5);
      const t2 = Math.min(rad, lb * 0.5);
      corners.push({
        s: [r + ((ar - r) / la) * t1, y + ((ay - y) / la) * t1],
        e: [r + ((br - r) / lb) * t2, y + ((by - y) / lb) * t2],
        p: [r, y],
        round: true,
      });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = corners[i];
      if (c.round) {
        for (let k = 0; k <= fseg; k++) {
          const t = k / fseg;
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const d = t * t;
          out.push([a * c.s[0] + b * c.p[0] + d * c.e[0], a * c.s[1] + b * c.p[1] + d * c.e[1]]);
        }
      } else out.push([c.p[0], c.p[1]]);
      if (i < n - 1) {
        const nx = corners[i + 1].s;
        const L = Math.hypot(nx[0] - c.e[0], nx[1] - c.e[1]);
        const m = Math.floor(L / step);
        for (let k = 1; k < m; k++) {
          const t = k / m;
          out.push([c.e[0] + (nx[0] - c.e[0]) * t, c.e[1] + (nx[1] - c.e[1]) * t]);
        }
      }
    }
    const clean = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const q = clean[clean.length - 1];
      if (Math.hypot(out[i][0] - q[0], out[i][1] - q[1]) > 1e-4) clean.push(out[i]);
    }
    return clean;
  }
  function arcPts(cx, cy, r, a0, a1, steps) {
    const o = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      o.push([Math.max(0, cx + Math.cos(a) * r), cy + Math.sin(a) * r]);
    }
    return o;
  }
  function profileFor(p) {
    switch (p.kind) {
      case 'drum':
        return fillet([[0, 0], [p.r, 0, p.b], [p.r, p.h, p.b], [0, p.h]]);
      case 'frustum':
        return fillet([[0, 0], [p.r0, 0, p.b], [p.r1, p.h, p.b * 0.8], [0, p.h]]);
      case 'cone':
        return fillet([[0, 0], [p.r, 0, p.b], [0.035, p.h, 0.07], [0, p.h]]);
      case 'spool':
        return fillet([[0, 0], [p.r, 0, p.b], [p.r, p.h * 0.17, p.b], [p.w, p.h * 0.5, p.h * 0.3], [p.r, p.h * 0.83, p.b], [p.r, p.h, p.b], [0, p.h]]);
      case 'capsule': {
        const a = arcPts(0, p.r, p.r, -Math.PI / 2, 0, 48);
        const s = [];
        const n = Math.floor((p.h - 2 * p.r) / 0.01);
        for (let k = 1; k < n; k++) s.push([p.r, p.r + ((p.h - 2 * p.r) * k) / n]);
        const b = arcPts(0, p.h - p.r, p.r, 0, Math.PI / 2, 48);
        return [...a, ...s, ...b];
      }
      case 'bowl': {
        const foot = p.r * 0.34;
        const pts = [[0, 0], [foot, 0, 0.025]];
        pts.push([foot, 0.05, 0.03]);
        for (let k = 1; k <= 14; k++) {
          const t = k / 14;
          pts.push([foot + (p.r - foot) * Math.sin((t * Math.PI) / 2), 0.05 + (p.h - 0.05) * (1 - Math.cos((t * Math.PI) / 2)), k === 14 ? 0.035 : 0]);
        }
        pts.push([0, p.h]);
        return fillet(pts);
      }
      case 'sphere':
        return arcPts(0, p.r, p.r, -Math.PI / 2, Math.PI / 2, 32);
      default:
        return [];
    }
  }
  const linear = (hex) => new THREE.Color(hex);
  const paletteLinear = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, linear(v)]));
  const WHITE_L = new THREE.Color(1, 1, 1);

  // per-vertex glaze colour: bands, pooling toward the foot, lighter glaze break on edges
  function paintVertex(p, yRel, ny, theta, out) {
    const base = p.gold ? WHITE_L : paletteLinear[p.col];
    out.copy(base);
    if (p.bands && !p.gold) {
      const yf = yRel / p.h + 0.012 * Math.sin(theta * 3 + p.h * 9);
      for (const [a, b, c] of p.bands) {
        const w = 0.012;
        const inBand = clamp((yf - a + w) / (2 * w), 0, 1) * clamp((b - yf + w) / (2 * w), 0, 1);
        if (inBand > 0) out.lerp(paletteLinear[c], inBand);
      }
    }
    const foot = 1 - 0.32 * Math.exp(-yRel / 0.05);
    const lip = 1 - 0.1 * Math.exp(-(p.h - yRel) / 0.03);
    let ao = foot * lip;
    if (ny < -0.6) ao *= 0.72;
    out.multiplyScalar(ao);
    const edge = Math.abs(ny);
    if (edge > 0.25 && edge < 0.93 && !p.gold) out.lerp(WHITE_L, 0.06);
  }

  function lathePiece(p, seed) {
    const prof = profileFor(p);
    const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
    const pos = geo.attributes.position;
    const P = prof.length;
    const amp = p.kind === 'sphere' ? 0.004 : 0.022;
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      for (let j = 0; j < P; j++) {
        const idx = i * P + j;
        const x = pos.getX(idx);
        const y = pos.getY(idx);
        const z = pos.getZ(idx);
        const f = 1 + amp * (0.6 * Math.sin(2 * th + seed + y * 2.1) + 0.4 * Math.sin(3 * th + seed * 1.7 - y * 3.3));
        pos.setXYZ(idx, x * f, y, z * f);
      }
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let j = 0; j < P; j++) {
      const a = j;
      const b = SEG * P + j;
      _vA.fromBufferAttribute(nrm, a).add(_vB.fromBufferAttribute(nrm, b)).normalize();
      nrm.setXYZ(a, _vA.x, _vA.y, _vA.z);
      nrm.setXYZ(b, _vA.x, _vA.y, _vA.z);
    }
    const cols = new Float32Array(pos.count * 3);
    const bis = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const th = Math.atan2(pos.getX(k), pos.getZ(k));
      paintVertex(p, y, nrm.getY(k), th, _c1);
      cols[k * 3] = _c1.r;
      cols[k * 3 + 1] = _c1.g;
      cols[k * 3 + 2] = _c1.b;
      bis[k] = bisqueAt(p, y);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('bisque', new THREE.BufferAttribute(bis, 1));
    geo.translate(0, -p.h / 2, 0);
    return geo;
  }
  // raw stoneware foot ring: the glaze stops just above the base of every thrown piece
  function bisqueAt(p, yRel) {
    if (p.gold || p.kind === 'torus' || p.kind === 'sphere') return 0;
    return 1 - smoothstep01((yRel - 0.012) / 0.02);
  }
  function smoothstep01(t) {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  }
  function colourise(p, geo) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const cols = new Float32Array(pos.count * 3);
    const bis = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + p.h / 2;
      paintVertex(p, y, nrm.getY(k), Math.atan2(pos.getX(k), pos.getZ(k)), _c1);
      cols[k * 3] = _c1.r;
      cols[k * 3 + 1] = _c1.g;
      cols[k * 3 + 2] = _c1.b;
      bis[k] = bisqueAt(p, y);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('bisque', new THREE.BufferAttribute(bis, 1));
    return geo;
  }
  function buildGeo(p, i) {
    if (p.kind === 'box') return colourise(p, new RoundedBoxGeometry(p.w, p.h, p.d, 5, p.rad));
    if (p.kind === 'torus') {
      const g = new THREE.TorusGeometry(p.R, p.tube, 24, 64);
      g.rotateX(Math.PI / 2);
      return colourise(p, g);
    }
    return lathePiece(p, i * 1.37 + 0.5);
  }

  /* ---------------- build pieces ---------------- */
  const root = new THREE.Group();
  scene.add(root);
  const pieceMeshes = PIECES.map((p, i) => {
    const geo = keep(buildGeo(p, i));
    const mat = glaze(p);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (p.mark) {
      const u = mat.userData.u;
      u.uMarkTex.value = letterTile(p.mark);
      if (p.kind === 'box') {
        u.uMarkMode.value = 1;
        u.uMarkRect.value.set(0, p.h * 0.36, p.w * 0.34, 0);
      } else if (p.kind === 'capsule') {
        u.uMarkRect.value.set(0, p.h * 0.2, 0.95, 0);
      } else {
        u.uMarkRect.value.set(0, p.h * 0.27, 0.62, 0);
      }
    }
    return mesh;
  });
  const goldMat = pieceMeshes[ID.ballO].material;
  goldMat.envMap = envForGold;
  goldMat.envMapIntensity = 2.1;

  /* ---------------- plinths ---------------- */
  const PLINTH_COUNT = 3;
  const plinthGeo = keep(new RoundedBoxGeometry(1, PLINTH_H, 1, 4, 0.045));
  const blobGeo = keep(new THREE.PlaneGeometry(1, 1));

  // Contact: a soft shadow in the empty slot on the ring, under the hovering piece.
  const slotMat = keep(new THREE.MeshBasicMaterial({ map: blobTex, color: HEX.ink, transparent: true, opacity: 0, depthWrite: false }));
  const slotBlob = new THREE.Mesh(blobGeo, slotMat);
  slotBlob.rotation.x = -Math.PI / 2;
  slotBlob.renderOrder = 2;
  slotBlob.visible = false;
  root.add(slotBlob);

  // Services: a real Bacterio laminate board standing on the floor behind the totems,
  // rising out of the floor like the plinths. It takes the totems' shadows.
  const WALL = { w: 9.35, h: 4.2, d: 0.08, z: -1.3 };
  const wallGeo = keep(new RoundedBoxGeometry(WALL.w, WALL.h, WALL.d, 2, 0.025));
  const wallEdge = keep(new THREE.MeshStandardMaterial({ color: HEX.ink, roughness: 0.62 }));
  const wallFace = keep(new THREE.MeshStandardMaterial({ color: HEX.white, map: wallTex, roughness: 0.72, metalness: 0 }));
  const wall = new THREE.Mesh(wallGeo, [wallEdge, wallEdge, wallEdge, wallEdge, wallFace, wallEdge]);
  wall.receiveShadow = true;
  wall.visible = false;
  root.add(wall);
  const plinths = [];
  for (let k = 0; k < PLINTH_COUNT; k++) {
    const mat = laminate();
    const mesh = new THREE.Mesh(plinthGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    const bm = keep(new THREE.MeshBasicMaterial({ map: blobTex, color: HEX.ink, transparent: true, opacity: 0.5, depthWrite: false }));
    const blob = new THREE.Mesh(blobGeo, bm);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.004;
    blob.renderOrder = 1;
    root.add(blob);
    plinths.push({ mesh, mat, blob, bm });
  }

  /* ---------------- arrangements → poses ---------------- */
  function nest(below, above, sb, sa) {
    if (above.kind === 'sphere' && below.kind === 'torus') {
      const R = below.R * sb;
      const t = below.tube * sb;
      const rs = above.r * sa;
      const hc = Math.sqrt(Math.max(0, (rs + t) * (rs + t) - R * R));
      return hc - t - rs;
    }
    if (above.kind === 'capsule') return -0.012 * sa;
    if (below.kind === 'capsule') return -0.025 * sb;
    if (above.kind === 'sphere') return -0.01 * sa;
    return 0;
  }
  // Exploded view: each joint opens by GAP per stack level. Where the open stack would
  // pass an arrangement's ceiling (so it would cross the nav), the whole open stack is
  // shifted down instead and the lowest pieces ride down with the sinking plinth.
  function compile(arr, phone) {
    const gapK = phone ? 0.05 : 0.11;
    const ceil = (phone ? arr.ceilP : arr.ceil) ?? Infinity;
    const poses = PIECES.map(() => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, s: 1, idx: 0, stack: -1, out: false, below: [], exLift: 0 }));
    const plinthPoses = [];
    arr.stacks.forEach((st, si) => {
      plinthPoses.push({ x: st.x, z: st.z, top: st.top, ps: st.ps, pr: st.pr ?? 0, base: ID[st.ids[0]] });
      let y = st.top;
      let prev = null;
      st.ids.forEach((k, idx) => {
        const id = ID[k];
        const p = PIECES[id];
        const s = st.s;
        if (prev) y += nest(prev, p, st.s, s);
        const q = poses[id];
        const flip = st.flip?.includes(k);
        q.x = st.x;
        q.z = st.z;
        q.y = y + (p.h * s) / 2;
        q.rx = flip ? Math.PI : 0;
        q.ry = (st.face ? 0 : p.ry ?? 0) + st.rot + idx * 0.37;
        if (st.face) q.ry = 0;
        q.s = s;
        q.idx = idx;
        q.stack = si;
        q.below = st.ids.slice(0, idx + 1).map((kk) => ID[kk]);
        if (st.hover === k) q.y += 0.62;
        y += p.h * s;
        prev = p;
      });
      let exTop = -Infinity;
      st.ids.forEach((k, idx) => {
        const q = poses[ID[k]];
        q.exLift = 0.2 + idx * gapK;
        exTop = Math.max(exTop, q.y + (PIECES[ID[k]].h * q.s) / 2 + q.exLift);
      });
      const excess = exTop - ceil;
      if (excess > 0) {
        let prevTop = 0.1;
        st.ids.forEach((k) => {
          const q = poses[ID[k]];
          const hh = (PIECES[ID[k]].h * q.s) / 2;
          const yEx = Math.max(q.y + q.exLift - excess, prevTop + 0.05 + hh);
          q.exLift = yEx - q.y;
          prevTop = yEx + hh;
        });
      }
    });
    while (plinthPoses.length < PLINTH_COUNT) plinthPoses.push({ x: 0, z: 0, top: -0.4, ps: 1.2, pr: 0, sunk: true });
    if (arr.out) {
      let n = 0;
      poses.forEach((q, i) => {
        if (q.stack >= 0) return;
        // parked under the floor: they sink out and later rise back up through it,
        // the way the plinths do, never across the nav or the copy
        q.out = true;
        q.x = (arr.parkX ?? 3.2) * (-1 + (n % 5) * 0.5);
        q.z = -1.5 + (n % 3) * 0.6;
        q.y = -1.5 - n * 0.3;
        q.rx = 0;
        q.ry = n * 0.9;
        q.s = 1;
        q.idx = 4 + n * 0.5;
        q.exLift = 0.2 + q.idx * gapK;
        n++;
      });
    }
    return { poses, plinthPoses };
  }
  const DESK_C = DESK.map((a) => compile(a, false));
  const PHONE_C = PHONE.map((a) => compile(a, true));

  // per-piece choreography constants (deterministic)
  const rndC = mulberry32(42);
  const SPIN = PIECES.map(() => (rndC() - 0.5) * 0.8);
  const TILTX = PIECES.map(() => (rndC() - 0.5) * 0.18);
  const TILTZ = PIECES.map(() => (rndC() - 0.5) * 0.18);
  // sideways/depth fan for the exploded view: alternating along the hero column so the
  // open stack reads as an ordered zig-zag, not a spill
  const FAN_X = PIECES.map((_, i) => (HERO_ORDER.indexOf(PIECES[i].key) % 2 ? 1 : -1) * (0.75 + 0.25 * rndC()));
  const FAN_Z = PIECES.map((_, i) => (Math.floor(HERO_ORDER.indexOf(PIECES[i].key) / 2) % 2 ? 1 : -1) * (0.7 + 0.3 * rndC()));

  // hover springs (secondary motion only)
  const springX = new Float32Array(PIECES.length);
  const springV = new Float32Array(PIECES.length);
  const liftOff = new Float32Array(PIECES.length);

  /* ---------------- overlay ---------------- */
  const el = document.createElement('div');
  el.className = 'totems-root';
  el.innerHTML = `
  <header class="totems-nav">
    <span class="totems-logo"><span class="totems-logo-mark"></span>ProDevly</span>
    <span class="totems-link">Services</span><span class="totems-link">Projects</span><span class="totems-link">Pricing</span><span class="totems-link">Developers</span>
    <span class="totems-navcta">Start a project</span>
    <span class="totems-menu">Menu</span>
  </header>

  <section class="totems-sec" data-s="0">
    <div class="totems-hero-copy">
      <p class="totems-eyebrow"><span>Web · SaaS · Software</span><i></i><span>Studio</span></p>
      <h1 class="totems-h1">Web apps, SaaS and custom software, built end to end.</h1>
      <p class="totems-p">One team for design, engineering and launch. We work with founders, growing businesses and agencies, in India and abroad.</p>
      <div class="totems-ctas"><span class="totems-btn">Start a project <i>→</i></span><span class="totems-textlink">See what we build</span></div>
    </div>
    <div class="totems-hero-label totems-label"><b>Totem No. 1 — Web app</b>Glazed components, variable.<br>ProDevly, 2026</div>
    <div class="totems-card totems-card-row">
      <div class="totems-label"><b>Totem No. 1 — Web app</b>Glazed components,<br>variable. ProDevly, 2026</div>
      <span class="totems-btn">Start a project <i>→</i></span>
    </div>
  </section>

  <section class="totems-sec" data-s="1">
    <div class="totems-copy">
      <p class="totems-eyebrow"><span>02</span><i></i><span>Services</span></p>
      <h2 class="totems-h2">Same parts. Different products.</h2>
      <p class="totems-p">Each build is assembled from the pieces it needs: interface, API, data and infrastructure, put together for your product.</p>
      <p class="totems-also">Also: Mobile apps · UI/UX design · Cloud &amp; DevOps</p>
    </div>
    <div class="totems-tag totems-label" data-t="0"><b>Web app</b>Totem No. 2<br>Interface, API, data</div>
    <div class="totems-tag totems-label" data-t="1"><b>SaaS product</b>Totem No. 3<br>Accounts, admin, integrations</div>
    <div class="totems-tag totems-label" data-t="2"><b>Custom software</b>Totem No. 4<br>Internal tools, CRMs, workflows</div>
    <div class="totems-card">
      <div class="totems-cols">
        <div class="totems-label"><b>Web app</b>Interface, API, data</div>
        <div class="totems-label"><b>SaaS product</b>Accounts, admin, integrations</div>
        <div class="totems-label"><b>Custom software</b>Internal tools, CRMs</div>
      </div>
      <p class="totems-card-note">Also: Mobile apps · UI/UX design · Cloud &amp; DevOps</p>
    </div>
  </section>

  <section class="totems-sec totems-on-dark-sec" data-s="2">
    <div class="totems-copy totems-copy-top">
      <p class="totems-eyebrow"><span>03</span><i></i><span>Projects</span></p>
      <h2 class="totems-h2">Every project gets its own plinth.</h2>
      <p class="totems-p">These three are samples. Real projects appear here as they are added in the admin.</p>
    </div>
    <div class="totems-tag totems-tag-l totems-label" data-t="0"><b>Sample project 01</b>Client, sector, stack<br>from the admin</div>
    <div class="totems-tag totems-tag-l totems-label" data-t="1"><b>Sample project 02</b>Placeholder plinth</div>
    <div class="totems-tag totems-tag-l totems-label" data-t="2"><b>Sample project 03</b>Placeholder plinth</div>
    <div class="totems-card">
      <div class="totems-label"><b>Sample projects</b>Placeholders. Client, sector, stack and link for each project come from the admin.</div>
    </div>
  </section>

  <section class="totems-sec" data-s="3">
    <div class="totems-copy totems-copy-top">
      <p class="totems-eyebrow"><span>04</span><i></i><span>Pricing</span></p>
      <h2 class="totems-h2">Engagements sized to the build.</h2>
      <p class="totems-p">More pieces, bigger build. Plan names and prices are set in the admin.</p>
    </div>
    <div class="totems-tag totems-label" data-t="0"><b>Sample plan S</b>3 pieces<br>Price from the admin</div>
    <div class="totems-tag totems-label" data-t="1"><b>Sample plan M</b>5 pieces<br>Price from the admin</div>
    <div class="totems-tag totems-label" data-t="2"><b>Sample plan L</b>7 pieces<br>Price from the admin</div>
    <div class="totems-card">
      <div class="totems-cols">
        <div class="totems-label"><b>Plan S</b>3 pieces</div>
        <div class="totems-label"><b>Plan M</b>5 pieces</div>
        <div class="totems-label"><b>Plan L</b>7 pieces</div>
      </div>
      <p class="totems-card-note">Sample names. Plans and prices are set in the admin.</p>
    </div>
  </section>

  <section class="totems-sec" data-s="4">
    <div class="totems-copy">
      <p class="totems-eyebrow"><span>05</span><i></i><span>Developers</span></p>
      <h2 class="totems-h2">Makers’ marks.</h2>
      <p class="totems-p">Each developer gets a maker’s mark. Names, roles and photos come from the team records.</p>
    </div>
    <div class="totems-tag totems-label" data-t="0"><b>Sample developer</b>Mark A<br>Role from the admin</div>
    <div class="totems-tag totems-label" data-t="1"><b>Sample developer</b>Mark L<br>Role from the admin</div>
    <div class="totems-tag totems-label" data-t="2"><b>Sample developer</b>Mark S<br>Role from the admin</div>
    <div class="totems-card">
      <div class="totems-cols">
        <div class="totems-label"><b>Mark A</b>Sample developer</div>
        <div class="totems-label"><b>Mark L</b>Sample developer</div>
        <div class="totems-label"><b>Mark S</b>Sample developer</div>
      </div>
      <p class="totems-card-note">Names, roles and photos come from the team records.</p>
    </div>
  </section>

  <section class="totems-sec totems-on-dark-sec" data-s="5">
    <div class="totems-copy totems-contact-copy">
      <p class="totems-eyebrow"><span>06</span><i></i><span>Contact</span></p>
      <h2 class="totems-h2">Add the next piece.</h2>
      <p class="totems-p">Tell us what you are building and the team will get back to you.</p>
    </div>
    <div class="totems-form">
      <label class="totems-field"><span>Name</span><em></em></label>
      <label class="totems-field"><span>Email</span><em></em></label>
      <label class="totems-field"><span>What are you building?</span><em></em></label>
      <span class="totems-btn">Start a project <i>→</i></span>
    </div>
    <div class="totems-card totems-card-contact">
      <div class="totems-label"><b>Tell us what you are building.</b>Name, email and a few lines about the project.</div>
      <span class="totems-btn">Start a project <i>→</i></span>
    </div>
    <footer class="totems-foot"><span>ProDevly</span><span>Web apps · SaaS · Custom software</span><span>© 2026 ProDevly</span></footer>
  </section>`;
  overlay.appendChild(el);
  const nav = el.querySelector('.totems-nav');
  const secEls = [...el.querySelectorAll('.totems-sec')];
  const tagEls = secEls.map((s) => [...s.querySelectorAll('.totems-tag')]);
  const secOpacity = new Float32Array(6).fill(-1);
  const secShift = new Float32Array(6).fill(-999);
  let navDark = false;
  const tagX = new Float32Array(18).fill(-1e4);
  const tagY = new Float32Array(18).fill(-1e4);

  const size = { w: 1, h: 1, phone: !!ctx.isPhone };
  function applyPhoneClass(ph) {
    el.classList.toggle('totems-ph', ph);
  }
  applyPhoneClass(size.phone);

  /* ---------------- per-frame helpers ---------------- */
  function sampleCam(frames, p) {
    let a = frames[0];
    let b = frames[frames.length - 1];
    if (p <= a.at) b = a;
    else if (p >= b.at) a = b;
    else {
      for (let i = 0; i < frames.length - 1; i++) {
        if (p >= frames[i].at && p <= frames[i + 1].at) {
          a = frames[i];
          b = frames[i + 1];
          break;
        }
      }
    }
    const t = a === b ? 0 : band(p, a.at, b.at);
    for (let k = 0; k < CAM_KEYS.length; k++) {
      const kk = CAM_KEYS[k];
      CAM[kk] = a[kk] + (b[kk] - a[kk]) * t;
    }
  }

  function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    _v.x = (_v.x * 0.5 + 0.5) * size.w;
    _v.y = (-_v.y * 0.5 + 0.5) * size.h;
    return _v;
  }

  /* ---------------- update ---------------- */
  const RIM_BY_FIELD = [1.25, 1.25, 2.2, 2.2, 1.25, 3.4];
  const WHITE_SRGB = new THREE.Color(HEX.white);
  function update({ progress, time, pointer, isPhone, dt }) {
    const p = clamp(progress, 0, 1);
    if (isPhone !== size.phone) {
      size.phone = isPhone;
      applyPhoneClass(isPhone);
    }
    const ARR = isPhone ? PHONE_C : DESK_C;
    const seg = Math.min(4, Math.floor(p / 0.2));
    const u = clamp((p - seg * 0.2) / 0.2, 0, 1);
    const A = ARR[seg];
    const B = ARR[seg + 1];
    const near = ARR[Math.round(p / 0.2)];

    /* camera */
    sampleCam(isPhone ? CAM_PHONE : CAM_DESK, p);
    const yaw = reduced ? 0 : pointer.x * 0.105; // ~6deg
    const pitch = reduced ? 0 : pointer.y * 0.05;
    const ox = CAM.px - CAM.tx;
    const oz = CAM.pz - CAM.tz;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const dist = Math.hypot(ox, oz);
    camera.position.set(CAM.tx + ox * cy + oz * sy, CAM.py + pitch * dist, CAM.tz - ox * sy + oz * cy);
    camera.lookAt(CAM.tx, CAM.ty, CAM.tz);
    camera.fov = 30;
    const filmW = camera.filmGauge * Math.min(camera.aspect, 1);
    camera.filmOffset = -CAM.fx * filmW * 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    /* field wipe */
    const wipe = band(u, 0.4, 0.62);
    hexToSRGB(HEX[FIELDS[seg]], bgUniforms.uA.value);
    hexToSRGB(HEX[FIELDS[seg + 1]], bgUniforms.uB.value);
    bgUniforms.uW.value = wipe;
    renderer.getDrawingBufferSize(bgUniforms.uRes.value);
    const darkB = DARK_FIELD[seg + 1];
    bgUniforms.uLine.value.set(darkB ? 0.98 : 0.078, darkB ? 0.98 : 0.078, darkB ? 0.97 : 0.078);

    // the floor (lower screen) changes field first, so floor tints switch early in the wipe.
    // Bounce light is the field half-way to white, so same-colour pieces don't melt into the wall.
    const floorMix = band(u, 0.4, 0.5);
    _c1.set(HEX[FIELDS[seg]]).lerp(_c2.set(HEX[FIELDS[seg + 1]]), floorMix);
    hemi.groundColor.copy(_c1).lerp(WHITE_SRGB, 0.5);
    _c1.set(SHADOW_TINT[seg]).lerp(_c2.set(SHADOW_TINT[seg + 1]), floorMix);
    shadowMat.color.copy(_c1);
    shadowMat.opacity = lerp(SHADOW_OPACITY[seg], SHADOW_OPACITY[seg + 1], floorMix);
    const darkness = lerp(DARK_FIELD[seg] ? 1 : 0, DARK_FIELD[seg + 1] ? 1 : 0, wipe);
    const blackness = seg + 1 === 5 ? wipe : 0;
    hemi.intensity = lerp(0.75, 0.42, blackness);
    key.intensity = lerp(2.5, 3.0, blackness);
    rim.intensity = lerp(RIM_BY_FIELD[seg], RIM_BY_FIELD[seg + 1], wipe);
    scene.environmentIntensity = lerp(0.95, 1.15, blackness);
    // horizon of the floor sweep, from camera pitch
    camera.getWorldDirection(_v);
    const viewPitch = Math.asin(clamp(_v.y, -1, 1));
    bgUniforms.uHorizon.value = 0.5 + (0.5 * Math.tan(-viewPitch)) / Math.tan((camera.fov * Math.PI) / 360);
    // spotlight wash behind the totem on the black field
    project(CAM.tx, CAM.ty + 0.4, 0);
    bgUniforms.uSpot.value.set(_v.x / size.w, 1 - _v.y / size.h, 0.07 * blackness, isPhone ? 0.42 : 0.38);

    /* services wall: rises out of the floor into Services, sinks on the way to Projects */
    const wallUp = seg === 0 ? band(u, 0.42, 0.74) : seg === 1 ? 1 - band(u, 0.12, 0.4) : 0;
    const wsy = isPhone ? 0.8 : 1;
    const wh = WALL.h * wsy;
    wall.scale.set(1, wsy, 1);
    wall.position.set(isPhone ? 0 : 0.92, lerp(-wh / 2 - 0.03, wh / 2, wallUp), WALL.z);
    wall.visible = wallUp > 0.001;

    /* pieces. Timing keeps big motion inside the copy-free middle of each transition:
       copy is gone by u≈0.22 and returns from u≈0.72. */
    const e1 = band(u, 0.14, 0.34);
    const e2 = band(u, 0.6, 0.8);
    const explode = e1 * (1 - e2);
    const restAmt = 1 - explode;
    const breatheW = reduced ? 0 : Math.max(1 - band(p, 0.02, 0.09), 0.55 * band(p, 0.93, 0.99)) * restAmt;
    const markAmt = band(p, 0.7, 0.78);
    const fanX = isPhone ? 0.9 : 0.3;
    const fanZ = isPhone ? 1.3 : 0.5;

    // hover target: nearest piece in screen space
    let hovered = -1;
    const pm = Math.abs(pointer.x) + Math.abs(pointer.y);
    if (!reduced && pm > 0.002 && explode < 0.05) {
      let best = 0.16;
      for (let i = 0; i < PIECES.length; i++) {
        const q = near.poses[i];
        if (q.out) continue;
        const m = pieceMeshes[i];
        _v.copy(m.position);
        _v.y -= liftOff[i];
        _v.project(camera);
        const dx = (_v.x - pointer.x) * camera.aspect;
        const dy = _v.y - pointer.y;
        const d = Math.hypot(dx, dy) / Math.max(0.4, q.s);
        if (d < best) {
          best = d;
          hovered = i;
        }
      }
    }
    const sdt = Math.min(dt || 0, 1 / 30);
    for (let i = 0; i < PIECES.length; i++) {
      const target = i === hovered ? 1 : 0;
      if (reduced) {
        springX[i] = 0;
        springV[i] = 0;
        continue;
      }
      // damping ratio ~0.6: a short, heavy ceramic settle, not a rubbery bounce
      const acc = 140 * (target - springX[i]) - 14 * springV[i];
      springV[i] += acc * sdt;
      springX[i] += springV[i] * sdt;
    }
    for (let i = 0; i < PIECES.length; i++) {
      const q = near.poses[i];
      let s = 0;
      if (q.stack >= 0) for (let k = 0; k < q.below.length; k++) s += springX[q.below[k]];
      liftOff[i] = s * 0.16;
    }

    let hoverW = 0;
    for (let i = 0; i < PIECES.length; i++) {
      const a = A.poses[i];
      const b = B.poses[i];
      const mesh = pieceMeshes[i];
      const st = 0.07 * (b.out ? Math.min(1, b.idx / 10) : b.idx / 6) + (a.out ? 0.05 * Math.min(1, a.idx / 8) : 0);
      const m = band(u, 0.28 + st, 0.58 + st * 0.5);
      // lift first, then travel: x/z hold until the flight is under way
      const mxz = band(m, 0.15, 1);
      const idxNow = lerp(a.idx, b.idx, m);
      const lift = explode * lerp(a.exLift, b.exLift, m);
      const travel = Math.hypot(b.x - a.x, b.z - a.z);
      const arc = Math.sin(Math.PI * m) * Math.min(0.6, travel * 0.25);
      const breathe = breatheW * idxNow * 0.022 * (0.5 + 0.5 * Math.sin(time * 1.25 - idxNow * 0.32));
      let y = lerp(a.y, b.y, m) + lift + arc + breathe + liftOff[i];
      const x = lerp(a.x, b.x, mxz) + explode * FAN_X[i] * fanX;
      const z = lerp(a.z, b.z, mxz) + explode * FAN_Z[i] * fanZ;
      const s = lerp(a.s, b.s, m);
      let ry = lerp(a.ry, b.ry, m) + explode * SPIN[i] + (reduced ? 0 : Math.sin(time * 0.4 + i) * 0.02);
      const rx = lerp(a.rx, b.rx, m) + explode * TILTX[i];
      const rz = explode * TILTZ[i] + (reduced ? 0 : springV[i] * 0.012);
      if (i === ID.ballO) {
        hoverW = band(p, 0.86, 0.97);
        y += reduced ? 0 : Math.sin(time * 1.5) * 0.05 * hoverW;
        ry += reduced ? 0 : time * 0.25 * hoverW;
        goldMat.emissiveIntensity = hoverW * 0.12;
        glow.intensity = hoverW * 2;
        // warm light pools in the empty slot on the ring, under the hovering piece
        glow.position.set(x, y - 0.55, z + 0.2);
      }
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.scale.setScalar(s);
      // pieces parked under the floor (developers chapter) are skipped entirely
      mesh.visible = !(a.out || b.out) || y + PIECES[i].h * s * 0.5 > -0.01;
      const u2 = mesh.material.userData.u;
      if (PIECES[i].mark) u2.uMark.value = markAmt;
    }
    {
      const ring = pieceMeshes[ID.ringN];
      const rp = PIECES[ID.ringN];
      const rs = ring.scale.x;
      slotBlob.position.set(ring.position.x, ring.position.y + rp.tube * rs + 0.004, ring.position.z);
      slotBlob.scale.setScalar((rp.R + rp.tube) * 2.2 * rs);
      slotMat.opacity = hoverW * 0.5;
      slotBlob.visible = hoverW > 0.01;
    }

    /* plinths */
    for (let k = 0; k < PLINTH_COUNT; k++) {
      const a = A.plinthPoses[k];
      const b = B.plinthPoses[k];
      const pl = plinths[k];
      const moved = Math.abs(a.x - b.x) + Math.abs(a.z - b.z) > 0.05 || a.sunk || b.sunk;
      let top;
      let x;
      let z;
      let ps;
      let pr;
      let useBase = u >= 0.44;
      if (!moved) {
        const t = band(u, 0.3, 0.72);
        top = lerp(a.top, b.top, t);
        ps = lerp(a.ps, b.ps, t);
        pr = lerp(a.pr, b.pr, t);
        x = a.x;
        z = a.z;
      } else {
        const sink = band(u, 0.12, 0.42);
        const rise = band(u, 0.46, 0.76);
        const first = u < 0.44;
        const aTop = a.sunk ? -0.4 : a.top;
        const bTop = b.sunk ? -0.4 : b.top;
        top = first ? lerp(aTop, -0.4, sink) : lerp(-0.4, bTop, rise);
        const useB = a.sunk || (!b.sunk && !first);
        useBase = useB;
        x = useB ? b.x : a.x;
        z = useB ? b.z : a.z;
        ps = useB ? b.ps : a.ps;
        pr = useB ? b.pr : a.pr;
      }
      // the plinth never rises through, or lags above, the piece it carries
      const baseId = (useBase ? b : a).base;
      if (baseId !== undefined) {
        const bm = pieceMeshes[baseId];
        if (bm.visible && Math.abs(bm.position.x - x) < ps * 0.5 && Math.abs(bm.position.z - z) < ps * 0.5) {
          top = Math.min(top, bm.position.y - (PIECES[baseId].h * bm.scale.x) / 2);
        }
      }
      pl.mesh.position.set(x, top - PLINTH_H / 2, z);
      pl.mesh.scale.set(ps, 1, ps);
      pl.mesh.rotation.y = pr;
      pl.mat.userData.u.uScale.value.set(ps, 1, ps);
      pl.mesh.visible = top > -0.35;
      const up = clamp(top / 0.4, 0, 1);
      pl.blob.position.set(x + 0.06, 0.004, z + 0.04);
      pl.blob.scale.set(ps * 1.75, ps * 1.75, 1);
      pl.bm.opacity = up * lerp(0.42, 0.75, darkness);
      pl.bm.color.copy(shadowMat.color);
      pl.blob.visible = up > 0.01;
    }

    /* overlay: section blocks (fully readable only while the pieces are at rest) */
    for (let i = 0; i < 6; i++) {
      const o = window01(p, AT[i] - 0.03, AT[i] + 0.02, 0.025);
      const shift = (AT[i] - p) * 40;
      if (Math.abs(o - secOpacity[i]) > 0.004) {
        secOpacity[i] = o;
        secEls[i].style.opacity = o.toFixed(3);
        secEls[i].style.visibility = o < 0.005 ? 'hidden' : 'visible';
      }
      if (o > 0.005 && Math.abs(shift - secShift[i]) > 0.05) {
        secShift[i] = shift;
        secEls[i].style.transform = `translate3d(0, ${shift.toFixed(2)}cqh, 0)`;
      }
    }
    const nd = DARK_FIELD[wipe > 0.93 ? seg + 1 : seg];
    if (nd !== navDark) {
      navDark = nd;
      nav.classList.toggle('totems-on-dark', nd);
    }

    /* overlay: museum labels hung under each plinth (desktop), kept inside the frame */
    if (!isPhone) {
      const sIdx = Math.round(p / 0.2);
      const tags = tagEls[sIdx];
      if (tags && tags.length && secOpacity[sIdx] > 0.005) {
        const arr = ARR[sIdx];
        const tagW = sIdx === 2 ? 0.14 * size.w : 0.15 * size.w;
        const tagH = 0.085 * size.h;
        for (let t = 0; t < tags.length; t++) {
          const pp = arr.plinthPoses[t];
          if (!pp) continue;
          let px;
          let py;
          if (sIdx === 2) {
            // gallery walk: the label hangs under the plinth's near (front-left) corner
            project(pp.x - pp.ps * 0.5, 0, pp.z + pp.ps * 0.5);
            px = clamp(_v.x, size.w * 0.03, size.w * 0.97 - tagW);
            py = _v.y + size.h * 0.02;
          } else {
            project(pp.x, 0, pp.z + pp.ps * 0.5);
            px = clamp(_v.x, size.w * 0.03 + tagW / 2, size.w * 0.97 - tagW / 2);
            py = _v.y + size.h * 0.025;
          }
          py = Math.min(py, size.h * 0.9);
          // never let two labels sit on each other mid-walk: drop the later one below
          for (let o = 0; o < t; o++) {
            const ko = sIdx * 3 + o;
            const left = sIdx === 2 ? px : px - tagW / 2;
            const leftO = sIdx === 2 ? tagX[ko] : tagX[ko] - tagW / 2;
            if (Math.abs(left - leftO) < tagW && Math.abs(py - tagY[ko]) < tagH) py = tagY[ko] + tagH;
          }
          const key2 = sIdx * 3 + t;
          if (Math.abs(px - tagX[key2]) > 0.4 || Math.abs(py - tagY[key2]) > 0.4) {
            tagX[key2] = px;
            tagY[key2] = py;
            tags[t].style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
          }
        }
      }
    }
  }

  function resize({ width, height, isPhone }) {
    size.w = width;
    size.h = height;
    if (isPhone !== size.phone) {
      size.phone = isPhone;
      applyPhoneClass(isPhone);
    }
  }

  function dispose() {
    scene.environment = prevEnv;
    scene.environmentIntensity = prevEnvIntensity ?? 1;
    scene.remove(root, bg, mask, shadowPlane, hemi, key, key.target, rim, glow);
    disposables.forEach((d) => d.dispose?.());
    key.shadow.map?.dispose?.();
    el.remove();
  }

  return { update, resize, dispose };
}

