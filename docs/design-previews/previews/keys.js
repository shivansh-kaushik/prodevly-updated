// Keycap Colorway — ProDevly direction preview.
// Every totem is a cairn of oversized sculpted keycaps. The same nine caps
// unstack, regroup and re-legend through six chapters; each chapter owns one
// colorway field, and fields change with a key-grid sweep, never a crossfade.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const meta = {
  id: 'keys',
  title: 'Keycap Colorway',
  stage: { background: '#2340C8', fov: 30, exposure: 1 },
  sections: [
    { key: 'hero', label: 'Hero', at: 0 },
    { key: 'services', label: 'Services', at: 0.2 },
    { key: 'projects', label: 'Projects', at: 0.4 },
    { key: 'pricing', label: 'Pricing', at: 0.6 },
    { key: 'team', label: 'Developers', at: 0.8 },
    { key: 'contact', label: 'Contact', at: 1 },
  ],
  fonts: [
    'Hubot+Sans:wdth,wght@75..125,200..900',
    'Mona+Sans:wdth,wght@75..125,200..900',
    'Martian+Mono:wdth,wght@75..112.5,100..800',
  ],
};

/* ------------------------------------------------------------------ palette */
const HEX = {
  chalk: '#EEF1F0',
  graphite: '#1B1D22',
  cobalt: '#2340C8',
  tomato: '#E5362C',
  yolk: '#F6C12B',
  mint: '#8FD8C0',
};
const SIDE = {
  chalk: '#C7CECB',
  graphite: '#08090B',
  cobalt: '#162A8E',
  tomato: '#A9221B',
  yolk: '#C9920E',
  mint: '#5FAE95',
};
// field per section: hero, services, projects, pricing, team, contact
const FIELD = ['cobalt', 'chalk', 'yolk', 'mint', 'tomato', 'graphite'];
const FIELD_DARK = [1, 0, 0, 0, 1, 1];

/* ------------------------------------------------------------------ css */
export const css = `
.keys-ov{position:absolute;inset:0;font-family:'Mona Sans',system-ui,sans-serif;font-weight:440;color:#EEF1F0;
  --u:6.4cqw;--chalk:#EEF1F0;--graphite:#1B1D22;--cobalt:#2340C8;--tomato:#E5362C;--yolk:#F6C12B;--mint:#8FD8C0;
  --ink:var(--chalk);-webkit-font-smoothing:antialiased}
.keys-ov[data-dark="0"]{--ink:var(--graphite)}
.keys-ov *{box-sizing:border-box;margin:0}
.keys-disp{font-family:'Hubot Sans','Mona Sans',system-ui,sans-serif;font-stretch:125%;font-weight:860;letter-spacing:-0.012em}
.keys-mono{font-family:'Martian Mono',ui-monospace,monospace;font-weight:500;font-stretch:100%;letter-spacing:0.02em}

/* nav */
.keys-nav{position:absolute;left:3.4cqw;right:3.4cqw;top:3.2cqh;display:flex;align-items:center;gap:2cqw;color:var(--ink)}
.keys-brand{font-family:'Hubot Sans',system-ui,sans-serif;font-stretch:125%;font-weight:880;font-size:1.55cqw;letter-spacing:-0.01em;line-height:1;display:flex;align-items:center;gap:.5em}
.keys-brand i{display:inline-block;inline-size:.78em;block-size:.78em;border-radius:.2em;background:var(--tomato);box-shadow:inset 0 -.16em 0 #A9221B}
.keys-navkeys{display:flex;gap:.45cqw;margin-inline-start:auto}
.keys-nk{position:relative;font-family:'Martian Mono',ui-monospace,monospace;font-weight:560;font-size:clamp(11px,.9cqw,13px);letter-spacing:.02em;
  min-inline-size:6.6cqw;padding:.55cqw .7cqw 1cqw;border-radius:.5cqw;background:var(--c);color:var(--i);
  box-shadow:inset 0 -.36cqw 0 var(--s),inset 0 .1cqw 0 rgba(255,255,255,.35),0 .3cqw .7cqw -.2cqw rgba(0,0,0,.35)}
.keys-nk b{position:absolute;right:.55cqw;top:.55cqw;inline-size:.42cqw;block-size:.42cqw;border-radius:50%;background:rgba(0,0,0,.18)}
.keys-nk.is-seen b{background:var(--led)}
.keys-nk.is-on{transform:translateY(.22cqw);box-shadow:inset 0 -.14cqw 0 var(--s),inset 0 .1cqw 0 rgba(255,255,255,.35),0 0 0 .12cqw var(--graphite)}
.keys-ov[data-field="5"] .keys-nk.is-on{box-shadow:inset 0 -.14cqw 0 var(--s),inset 0 .1cqw 0 rgba(255,255,255,.2),0 0 0 .12cqw rgba(238,241,240,.7)}
.keys-ov[data-field="4"] .keys-brand i{background:var(--chalk);box-shadow:inset 0 -.16em 0 #C7CECB}
.keys-key{position:relative;display:inline-flex;align-items:flex-end;justify-content:space-between;gap:1.1cqw;
  font-family:'Martian Mono',ui-monospace,monospace;font-weight:600;letter-spacing:.01em;color:var(--kc-i,#EEF1F0);
  background:var(--kc,#E5362C);border-radius:.8cqw;
  box-shadow:inset 0 -.62cqw 0 var(--ks,#A9221B),inset 0 .14cqw 0 rgba(255,255,255,.32),0 .9cqw 1.6cqw -.7cqw rgba(0,0,0,.55)}
.keys-key svg{inline-size:1.25em;block-size:1.25em;flex:none}
.keys-navcta{font-size:clamp(11px,.85cqw,13px);padding:.7cqw .9cqw 1.25cqw}
.keys-menu{display:none}

/* sections */
.keys-s{position:absolute;opacity:0;will-change:opacity,transform}
.keys-idx{font-family:'Martian Mono',ui-monospace,monospace;font-weight:500;font-size:clamp(11px,.88cqw,13px);letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;gap:.8cqw}
.keys-idx::before{content:'';inline-size:2.2cqw;block-size:.14cqw;background:currentColor}
.keys-h1{font-family:'Hubot Sans',system-ui,sans-serif;font-stretch:125%;font-weight:880;font-size:4.25cqw;line-height:.96;letter-spacing:-0.018em;text-wrap:balance;margin-block:1.6cqh 2.6cqh}
.keys-h2{font-family:'Hubot Sans',system-ui,sans-serif;font-stretch:125%;font-weight:860;font-size:3.5cqw;line-height:.96;letter-spacing:-0.016em;text-wrap:balance;margin-block:1.4cqh 1.8cqh}
.keys-body{font-size:1.14cqw;line-height:1.5;max-inline-size:30cqw}
.keys-lede{font-size:1.2cqw;line-height:1.5;max-inline-size:31cqw;margin-block-end:3.4cqh;opacity:.92}
.keys-hint{display:flex;align-items:center;gap:.8cqw;margin-block-start:3.2cqh;font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.85cqw,13px);letter-spacing:.02em;opacity:.92}
.keys-mini{display:inline-grid;place-items:center;inline-size:1.9cqw;block-size:1.9cqw;padding-block-end:.25cqw;border-radius:.35cqw;background:var(--chalk);color:var(--graphite);font-weight:600;box-shadow:inset 0 -.28cqw 0 #C7CECB}
.is-phone .keys-hint{display:none}
.keys-cta{font-size:clamp(13px,1.1cqw,16px);font-weight:700;padding:1.15cqw 1.3cqw 1.9cqw;inline-size:calc(var(--u)*2.25*1.32)}

.keys-hero{left:4.6cqw;top:19cqh;inline-size:48cqw;color:var(--chalk)}
.keys-svc{right:4.6cqw;top:17cqh;inline-size:30cqw;color:var(--graphite)}
.keys-svclist{list-style:none;padding:0;margin-block-start:3cqh;display:grid;grid-template-columns:1fr 1fr;gap:.55cqw}
.keys-svclist li{font-family:'Martian Mono',ui-monospace,monospace;font-weight:500;font-size:clamp(11px,.85cqw,13px);letter-spacing:.01em;padding:.7cqw .8cqw .95cqw;border-radius:.45cqw;
  background:#fff;box-shadow:inset 0 -.28cqw 0 #C7CECB}
.keys-svclist li.is-on{background:#1B1D22;color:#EEF1F0;box-shadow:inset 0 -.12cqw 0 #000;transform:translateY(.16cqw)}
.keys-proj{left:4.6cqw;top:15cqh;inline-size:34cqw;color:var(--graphite)}
.keys-tagrow{display:flex;gap:.6cqw;margin-block-start:2cqh}
.keys-tag{font-family:'Martian Mono',ui-monospace,monospace;font-weight:600;font-size:clamp(11px,.8cqw,12px);letter-spacing:.05em;text-transform:uppercase;padding:.45cqw .65cqw;border-radius:.35cqw;background:var(--graphite);color:var(--yolk)}
.keys-price{left:4.6cqw;top:14cqh;inline-size:40cqw;color:var(--graphite)}
.keys-plan{position:absolute;left:0;top:0;opacity:0;inline-size:15cqw;transform:translate(-50%,0);text-align:center;color:var(--graphite);
  font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.85cqw,13px);line-height:1.45;font-weight:500}
.keys-plan b{display:block;font-family:'Hubot Sans',system-ui,sans-serif;font-stretch:125%;font-weight:840;font-size:clamp(15px,1.3cqw,19px);letter-spacing:-.01em;margin-block-end:.2cqh}
.keys-plan em{display:block;font-style:normal}
.keys-plan span{display:inline-block;margin-block-start:.5cqh;padding:.3cqw .55cqw;border-radius:.3cqw;background:var(--graphite);color:var(--mint);font-size:clamp(10px,.75cqw,12px);letter-spacing:.04em;text-transform:uppercase}
.keys-team{left:4.6cqw;top:13cqh;inline-size:46cqw;color:var(--chalk)}
.keys-team .keys-h2{font-size:4.1cqw}
.keys-team .keys-idx{display:inline-flex;background:var(--graphite);color:var(--chalk);padding:.5cqw .8cqw;border-radius:.35cqw}
.keys-team .keys-idx::before{background:var(--tomato)}
.keys-dev{position:absolute;left:0;top:0;opacity:0;transform:translate(-50%,0);text-align:center;padding:.5cqw .7cqw .75cqw;border-radius:.4cqw;background:var(--chalk);color:var(--graphite);
  font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.85cqw,13px);line-height:1.4;font-weight:500;box-shadow:inset 0 -.24cqw 0 #C7CECB;white-space:nowrap}
.keys-dev b{display:block;font-family:'Hubot Sans',system-ui,sans-serif;font-stretch:125%;font-weight:820;font-size:clamp(12px,1cqw,15px)}
.keys-contact{left:4.6cqw;top:14cqh;inline-size:40cqw;color:var(--chalk)}
.keys-form{display:grid;gap:.7cqw;margin-block-start:3cqh;inline-size:32cqw}
.keys-field{font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.85cqw,13px);letter-spacing:.02em;color:rgba(238,241,240,.7);padding:1cqw 1.1cqw;border-radius:.55cqw;background:#2A2D34;box-shadow:inset 0 .22cqw 0 #121317}
.keys-field--tall{padding-block-end:3.4cqw}
.keys-formrow{display:flex;align-items:center;justify-content:space-between;gap:1cqw;margin-block-start:.4cqw}
.keys-fine{font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.85cqw,13px);color:rgba(238,241,240,.72);letter-spacing:.02em}
.keys-send{font-size:clamp(12px,1cqw,15px);font-weight:700;padding:1cqw 1.2cqw 1.7cqw;inline-size:calc(var(--u)*2.25*.95)}

.keys-colorway{position:absolute;left:4.6cqw;bottom:3.6cqh;display:flex;align-items:center;gap:.5cqw;font-family:'Martian Mono',ui-monospace,monospace;font-size:clamp(11px,.8cqw,12px);letter-spacing:.06em;text-transform:uppercase;color:var(--ink)}
.keys-colorway i{inline-size:1.15cqw;block-size:1.15cqw;border-radius:.25cqw;background:var(--c);box-shadow:inset 0 -.2cqw 0 rgba(0,0,0,.28),0 0 0 .08cqw rgba(0,0,0,.12)}
.keys-colorway i.is-on{transform:translateY(-.3cqw) scale(1.18)}

/* phone */
.keys-ov.is-phone{--u:13cqw}
.is-phone .keys-nav{left:5.4cqw;right:5.4cqw;top:3cqh;gap:3cqw}
.is-phone .keys-brand{font-size:5.4cqw}
.is-phone .keys-navkeys{gap:1.2cqw}
.is-phone .keys-nk{min-inline-size:0;inline-size:4.6cqw;block-size:4.6cqw;padding:0;font-size:0;border-radius:1.1cqw;box-shadow:inset 0 -1cqw 0 var(--s),0 .6cqw 1cqw -.5cqw rgba(0,0,0,.35)}
.is-phone .keys-nk b{right:auto;left:50%;top:32%;inline-size:1.3cqw;block-size:1.3cqw;transform:translateX(-50%)}
.is-phone .keys-nk.is-on{transform:translateY(.5cqw);box-shadow:inset 0 -.35cqw 0 var(--s)}
.is-phone .keys-navcta{display:none}
.is-phone .keys-menu{display:inline-flex;align-items:center;justify-content:center;block-size:6.4cqw;padding:0 2.4cqw 1cqw;margin-inline-start:.6cqw;border-radius:1.3cqw;
  font-family:'Martian Mono',ui-monospace,monospace;font-weight:600;font-size:2.9cqw;letter-spacing:.02em;background:var(--chalk);color:var(--graphite);
  box-shadow:inset 0 -1cqw 0 #C7CECB,0 .6cqw 1cqw -.5cqw rgba(0,0,0,.35)}
.keys-ov[data-field="1"].is-phone .keys-menu{background:var(--graphite);color:var(--chalk);box-shadow:inset 0 -1cqw 0 #08090B,0 .6cqw 1cqw -.5cqw rgba(0,0,0,.35)}
.is-phone .keys-idx{font-size:3cqw;gap:2cqw}
.is-phone .keys-idx::before{inline-size:6cqw;block-size:.45cqw}
.is-phone .keys-h1{font-size:9cqw;line-height:.95;margin-block:1.4cqh 0}
.is-phone .keys-h2{font-size:8.6cqw;margin-block:1cqh 1cqh}
.is-phone .keys-body{font-size:3.7cqw;max-inline-size:none}
.is-phone .keys-lede{display:none}
.is-phone .keys-hero{left:5.4cqw;right:5.4cqw;top:11.5cqh;inline-size:auto}
.is-phone .keys-cta{position:absolute;left:0;right:0;inline-size:auto;top:73cqh;font-size:3.9cqw;padding:3.6cqw 4.2cqw 5.6cqw;border-radius:2.6cqw;box-shadow:inset 0 -2cqw 0 #A9221B,inset 0 .4cqw 0 rgba(255,255,255,.32),0 3cqw 4cqw -2.4cqw rgba(0,0,0,.55)}
.is-phone .keys-svc,.is-phone .keys-proj,.is-phone .keys-price,.is-phone .keys-team,.is-phone .keys-contact{left:5.4cqw;right:5.4cqw;top:10.5cqh;inline-size:auto}
.is-phone .keys-team .keys-h2{font-size:8.6cqw}
.is-phone .keys-svclist{display:none}
.is-phone .keys-card{position:absolute;left:5.4cqw;right:5.4cqw;top:auto;bottom:4.2cqh;padding:3.6cqw 4cqw 5cqw;border-radius:2.6cqw}
.keys-card{display:none}
.is-phone .keys-card{display:block}
.is-phone .keys-desk{display:none}
.is-phone .keys-tagrow{margin-block-start:1cqh}
.is-phone .keys-tag{font-size:2.9cqw;padding:1.2cqw 1.8cqw;border-radius:1cqw}
.is-phone .keys-dev{display:none}
.is-phone .keys-plan{inline-size:auto;transform:none;text-align:left;font-size:2.9cqw;line-height:1;white-space:nowrap;display:flex;align-items:baseline;gap:1.6cqw;
  padding:1.5cqw 2.2cqw 2.1cqw;border-radius:1.2cqw;background:var(--chalk);box-shadow:inset 0 -.8cqw 0 #C7CECB,0 .8cqw 1.4cqw -.8cqw rgba(0,0,0,.45)}
.is-phone .keys-plan b{display:inline;font-size:3.9cqw;margin:0}
.is-phone .keys-plan em{display:inline}
.is-phone .keys-plan span{display:none}
.is-phone .keys-form{display:none}
.is-phone .keys-colorway{display:none}
.keys-card p{font-size:3.5cqw;line-height:1.45}
.keys-card .keys-mono{font-size:3cqw;letter-spacing:.05em;text-transform:uppercase;margin-block-end:1.4cqw;display:block}
.keys-card--chalk{background:#EEF1F0;color:#1B1D22;box-shadow:inset 0 -1.4cqw 0 #C7CECB}
.keys-card--graphite{background:#1B1D22;color:#EEF1F0;box-shadow:inset 0 -1.4cqw 0 #08090B}
.keys-card--white{background:#fff;color:#1B1D22;box-shadow:inset 0 -1.4cqw 0 #C7CECB}
.keys-card .keys-key{margin-block-start:3cqw;inline-size:100%;font-size:3.6cqw;padding:3cqw 3.6cqw 4.6cqw;border-radius:2.2cqw;box-shadow:inset 0 -1.6cqw 0 #A9221B,inset 0 .4cqw 0 rgba(255,255,255,.3)}
`;

/* ------------------------------------------------------------------ scratch (no allocation in update) */
let _v3 = null;
let _c1 = null;
let _c2 = null;

/* ------------------------------------------------------------------ helpers */
const D2R = Math.PI / 180;
const ENTER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 5v7a3 3 0 0 1-3 3H6"/><path d="M10 11l-4 4 4 4"/></svg>';

/**
 * Sculpted keycap: tapered rounded-rect loft, rounded top bevel, cylindrical
 * (Cherry/OEM style) dish curved front-to-back only, small bottom bevel. The dish
 * is a smooth function of z, so it has no diagonal folds on wide caps; its normals
 * are written analytically. The rim follows the cylinder, dipping at the sides.
 * UV is a planar top-down projection of the footprint, so sides land in the
 * plain-colour margin of the legend tile and the top face carries the print.
 */
function keycapGeometry(THREE, o) {
  const hw0 = o.u / 2 - 0.03;
  const hd0 = (o.d ?? 1) / 2 - 0.03;
  const h = o.h ?? 0.6;
  const tx = o.taperX ?? 0.1;
  const tzF = o.taperF ?? 0.13;
  const tzB = o.taperB ?? 0.06;
  const rB = o.rBot ?? 0.1;
  const rT = o.rTop ?? 0.13;
  const bev = o.bevel ?? 0.065;
  const dish = o.dish ?? 0.045;
  const bb = 0.02;
  const C = 7;
  const S = h - bev;
  const hwS = hw0 - tx;
  const zF = hd0 - tzF;
  const zB = -(hd0 - tzB);
  const hdS = (zF - zB) / 2;
  const czS = (zF + zB) / 2;
  const Nx = Math.max(2, Math.ceil((hw0 * 2) / 0.16));
  const Nz = Math.max(2, Math.ceil((hd0 * 2) / 0.16));

  const rings = [];
  // bottom bevel ring (inset), then side rings, bevel arc, top dish rings
  rings.push({ hw: hw0 - bb, hd: hd0 - bb, r: rB - bb * 0.5, y: 0, cz: 0, top: 0, dw: 0 });
  const sideT = [0, 0.12, 0.5, 0.88, 1];
  for (const t of sideT) {
    rings.push({
      hw: hw0 + (hwS - hw0) * t,
      hd: hd0 + (hdS - hd0) * t,
      r: rB + (rT - rB) * t,
      y: bb + (S - bb) * t,
      cz: czS * t,
      top: 0,
      dw: 0,
    });
  }
  const bevSteps = 5;
  for (let i = 1; i <= bevSteps; i++) {
    const ph = (i / bevSteps) * Math.PI * 0.5;
    const inset = bev * (1 - Math.cos(ph));
    rings.push({
      hw: hwS - inset,
      hd: hdS - inset,
      r: Math.max(0.02, rT - inset * 0.55),
      y: S + bev * Math.sin(ph),
      cz: czS,
      top: 1,
      dw: 1 - Math.cos(ph),
    });
  }
  const hwT = hwS - bev;
  const hdT = hdS - bev;
  const rTT = Math.max(0.02, rT - bev * 0.55);
  const topS = [0.93, 0.84, 0.72, 0.58, 0.43, 0.28, 0.14];
  const firstDish = rings.length;
  for (const s of topS) {
    rings.push({ hw: hwT * s, hd: hdT * s, r: rTT * s, y: h, cz: czS, top: 1, dw: 1 });
  }
  // cylindrical dish depth at z (0 at the front/back rim, `dish` along the centre line)
  const dishAt = (z) => {
    const u = Math.max(-1, Math.min(1, (z - czS) / hdT));
    return dish * (1 - u * u);
  };

  const pos = [];
  const uv = [];
  const uv1 = [];
  const uv2 = [];
  const tilt = o.tilt ?? 0;
  let topRing = 0;
  const pushV = (x, y, z) => {
    pos.push(x, y, z);
    uv.push((x + hw0) / (2 * hw0), (hd0 - z) / (2 * hd0));
    uv1.push((x + z * 0.7) * 1.6, (y + (topRing ? z : 0)) * 1.6);
    uv2.push(0.5, Math.max(0, y) / h);
  };

  let M = 0;
  for (const R of rings) {
    const r = Math.min(R.r, R.hw - 1e-3, R.hd - 1e-3);
    const ex = R.hw - r;
    const ez = R.hd - r;
    const pts = [];
    const corner = (cx, cz, a0) => {
      for (let j = 0; j <= C; j++) {
        const a = a0 + (j / C) * Math.PI * 0.5;
        pts.push(cx + r * Math.cos(a), cz + r * Math.sin(a));
      }
    };
    corner(ex, ez, 0);
    for (let j = 1; j < Nx; j++) pts.push(ex - (2 * ex * j) / Nx, R.hd);
    corner(-ex, ez, Math.PI * 0.5);
    for (let j = 1; j < Nz; j++) pts.push(-R.hw, ez - (2 * ez * j) / Nz);
    corner(-ex, -ez, Math.PI);
    for (let j = 1; j < Nx; j++) pts.push(-ex + (2 * ex * j) / Nx, -R.hd);
    corner(ex, -ez, Math.PI * 1.5);
    for (let j = 1; j < Nz; j++) pts.push(R.hw, -ez + (2 * ez * j) / Nz);
    M = pts.length / 2;
    topRing = R.top;
    for (let k = 0; k < M; k++) {
      const x = pts[k * 2];
      const z = pts[k * 2 + 1] + R.cz;
      const ty = R.top ? tilt * ((z - czS) / Math.max(0.1, hdS)) : 0;
      pushV(x, R.y + ty - (R.dw ? dishAt(z) * R.dw : 0), z);
    }
  }
  const nR = rings.length;
  const bottomC = nR * M;
  topRing = 0;
  pushV(0, 0, 0);
  const topC = bottomC + 1;
  topRing = 1;
  pushV(0, h - dish, czS);

  const idx = [];
  for (let i = 0; i < nR - 1; i++) {
    for (let k = 0; k < M; k++) {
      const a = i * M + k;
      const b = i * M + ((k + 1) % M);
      const c = (i + 1) * M + k;
      const d = (i + 1) * M + ((k + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let k = 0; k < M; k++) idx.push(bottomC, k, (k + 1) % M);
  const last = (nR - 1) * M;
  for (let k = 0; k < M; k++) idx.push(last + k, topC, last + ((k + 1) % M));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // winding check: top centre normal must point up
  const n = g.attributes.normal;
  if (n.getY(topC) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  // analytic normals across the dish: y = h - dish(1-u^2) + tilt*z/hdS
  {
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const tz = tilt / Math.max(0.1, hdS);
    const fix = (vi) => {
      const z = pa.getZ(vi);
      const u = (z - czS) / hdT;
      const dydz = (Math.abs(u) < 1 ? (2 * dish * u) / hdT : 0) + tz;
      const l = Math.hypot(1, dydz);
      na.setXYZ(vi, 0, 1 / l, -dydz / l);
    };
    for (let vi = firstDish * M; vi < nR * M; vi++) fix(vi);
    fix(topC);
    na.needsUpdate = true;
  }
  g.computeBoundingSphere();
  g.userData = {
    hw0,
    hd0,
    h,
    // printable rect on the tile, as 0..1 fractions (x from left, y from top of tile)
    print: {
      x0: (-hwT + hw0) / (2 * hw0),
      x1: (hwT + hw0) / (2 * hw0),
      y0: (czS - hdT + hd0) / (2 * hd0),
      y1: (czS + hdT + hd0) / (2 * hd0),
    },
  };
  return g;
}

/* ------------------------------------------------------------------ legends (canvas, doubleshot look) */
function setFont(c, weight, px, fam, stretch) {
  c.font = `${weight} ${px}px ${fam}`;
  try {
    c.fontStretch = stretch || 'normal';
  } catch (e) {
    /* older canvas */
  }
}
const F_DISP = "'Hubot Sans', 'Mona Sans', system-ui, sans-serif";
const F_MONO = "'Martian Mono', ui-monospace, monospace";

function fitText(c, text, maxW, weight, px, fam, stretch) {
  let s = px;
  setFont(c, weight, s, fam, stretch);
  while (s > 8 && c.measureText(text).width > maxW) {
    s -= 1;
    setFont(c, weight, s, fam, stretch);
  }
  return s;
}

function drawIcon(c, kind, x, y, s, ink) {
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = Math.max(2, s * 0.11);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'shift') {
    c.moveTo(x + s * 0.5, y);
    c.lineTo(x + s, y + s * 0.5);
    c.lineTo(x + s * 0.72, y + s * 0.5);
    c.lineTo(x + s * 0.72, y + s);
    c.lineTo(x + s * 0.28, y + s);
    c.lineTo(x + s * 0.28, y + s * 0.5);
    c.lineTo(x, y + s * 0.5);
    c.closePath();
    c.stroke();
  } else if (kind === 'enter') {
    c.moveTo(x + s * 0.95, y + s * 0.05);
    c.lineTo(x + s * 0.95, y + s * 0.62);
    c.lineTo(x + s * 0.1, y + s * 0.62);
    c.moveTo(x + s * 0.38, y + s * 0.34);
    c.lineTo(x + s * 0.1, y + s * 0.62);
    c.lineTo(x + s * 0.38, y + s * 0.9);
    c.stroke();
  } else if (kind === 'tab') {
    c.moveTo(x, y + s * 0.5);
    c.lineTo(x + s * 0.82, y + s * 0.5);
    c.moveTo(x + s * 0.52, y + s * 0.2);
    c.lineTo(x + s * 0.82, y + s * 0.5);
    c.lineTo(x + s * 0.52, y + s * 0.8);
    c.moveTo(x + s, y + s * 0.15);
    c.lineTo(x + s, y + s * 0.85);
    c.stroke();
  } else if (kind === 'opt') {
    c.moveTo(x, y + s * 0.2);
    c.lineTo(x + s * 0.32, y + s * 0.2);
    c.lineTo(x + s * 0.68, y + s * 0.8);
    c.lineTo(x + s, y + s * 0.8);
    c.moveTo(x + s * 0.6, y + s * 0.2);
    c.lineTo(x + s, y + s * 0.2);
    c.stroke();
  } else if (kind === 'cmd') {
    const r = s * 0.16;
    const a = x + s * 0.32;
    const b = x + s * 0.68;
    const t = y + s * 0.32;
    const u = y + s * 0.68;
    c.strokeRect(a, t, b - a, u - t);
    for (const [cx, cy] of [[a - r, t - r], [b + r, t - r], [a - r, u + r], [b + r, u + r]]) {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
    }
  }
  c.restore();
}

function drawLegend(c, L, X, Y, W, H, inkIn) {
  let ink = inkIn;
  // X,Y,W,H = printable rect in px
  const pad = Math.min(W, H) * 0.12;
  const x0 = X + pad;
  const y0 = Y + pad;
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  c.fillStyle = ink;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  if (L.k === 'key') {
    const fs = Math.round(ih * 0.22);
    setFont(c, 560, fs, F_MONO);
    c.fillText(L.t, x0, y0 + ih);
    if (L.icon) drawIcon(c, L.icon, x0, y0, Math.round(ih * 0.3), ink);
  } else if (L.k === 'svc') {
    setFont(c, 560, Math.round(ih * 0.15), F_MONO);
    c.fillText(L.n, x0, y0 + ih * 0.15);
    const lines = L.t;
    const maxFs = Math.round(ih * (lines.length > 1 ? 0.27 : 0.32));
    let fs = maxFs;
    for (const ln of lines) fs = Math.min(fs, fitText(c, ln, iw, 860, maxFs, F_DISP, 'expanded'));
    setFont(c, 860, fs, F_DISP, 'expanded');
    for (let i = 0; i < lines.length; i++) {
      c.fillText(lines[i], x0, y0 + ih - (lines.length - 1 - i) * fs * 1.0);
    }
  } else if (L.k === 'proj') {
    // sample sleeve: title row at the top edge, a wireframe "browser" thumbnail below.
    // `panel` prints a graphite face first so a yolk sleeve still reads on the yolk field.
    if (L.panel) {
      c.fillStyle = HEX.graphite;
      roundRect(c, X + pad * 0.45, Y + pad * 0.45, W - pad * 0.9, H - pad * 0.9, Math.min(W, H) * 0.08);
      c.fill();
      ink = L.panel;
      c.fillStyle = ink;
    }
    const fs = fitText(c, 'SAMPLE PROJECT', iw * 0.74, 600, Math.round(ih * 0.13), F_MONO);
    setFont(c, 600, fs, F_MONO);
    c.fillText('SAMPLE PROJECT', x0, y0 + fs * 0.9);
    c.textAlign = 'right';
    c.fillText(L.n, x0 + iw, y0 + fs * 0.9);
    c.textAlign = 'left';
    const fw = iw;
    const fy = y0 + fs * 1.55;
    const fh = ih - fs * 1.55;
    const lw = Math.max(2, ih * 0.035);
    c.save();
    c.strokeStyle = ink;
    c.fillStyle = ink;
    c.lineWidth = lw;
    const rr = ih * 0.06;
    roundRect(c, x0, fy, fw, fh, rr);
    c.stroke();
    c.beginPath();
    c.moveTo(x0, fy + fh * 0.2);
    c.lineTo(x0 + fw, fy + fh * 0.2);
    c.stroke();
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(x0 + fh * 0.1 + i * fh * 0.1, fy + fh * 0.1, fh * 0.032, 0, Math.PI * 2);
      c.fill();
    }
    const inX = x0 + fw * 0.07;
    const inY = fy + fh * 0.32;
    if (L.kind === 'dash') {
      c.fillRect(inX, inY, fw * 0.18, fh * 0.56);
      for (let i = 0; i < 3; i++) c.fillRect(inX + fw * 0.24 + i * fw * 0.22, inY, fw * 0.18, fh * 0.2);
      c.globalAlpha = 0.5;
      c.fillRect(inX + fw * 0.24, inY + fh * 0.28, fw * 0.62, fh * 0.28);
    } else if (L.kind === 'shop') {
      for (let i = 0; i < 4; i++) {
        c.globalAlpha = i % 2 ? 0.55 : 1;
        c.fillRect(inX + i * fw * 0.22, inY, fw * 0.18, fh * 0.36);
      }
      c.globalAlpha = 1;
      c.fillRect(inX, inY + fh * 0.46, fw * 0.4, fh * 0.08);
    } else if (L.kind === 'app') {
      c.fillRect(inX, inY, fw * 0.5, fh * 0.12);
      c.globalAlpha = 0.55;
      c.fillRect(inX, inY + fh * 0.2, fw * 0.36, fh * 0.07);
      c.globalAlpha = 1;
      roundRect(c, inX + fw * 0.58, inY - fh * 0.02, fw * 0.28, fh * 0.6, fh * 0.06);
      c.stroke();
    } else {
      c.fillRect(inX, inY, fw * 0.62, fh * 0.14);
      c.globalAlpha = 0.55;
      c.fillRect(inX, inY + fh * 0.22, fw * 0.44, fh * 0.07);
      c.globalAlpha = 1;
      c.fillRect(inX, inY + fh * 0.4, fw * 0.2, fh * 0.12);
    }
    c.restore();
  } else if (L.k === 'num') {
    // number-row legend: a developer slot, numbered, marked as a sample
    const fs = Math.round(ih * 0.5);
    setFont(c, 880, fs, F_DISP, 'expanded');
    c.fillText(L.t, x0 + iw * 0.02, y0 + fs * 0.86);
    const ms = fitText(c, 'SAMPLE', iw * 0.9, 600, Math.round(ih * 0.16), F_MONO);
    setFont(c, 600, ms, F_MONO);
    c.fillText('SAMPLE', x0 + iw * 0.02, y0 + ih * 0.9);
  } else if (L.k === 'brand') {
    const fs = Math.round(ih * 0.3);
    setFont(c, 880, fs, F_DISP, 'expanded');
    if (L.al === 'r') {
      // hero: the caps stacked on the bar would hide a centred legend
      c.textAlign = 'right';
      c.fillText('prodevly', x0 + iw - pad * 0.4, y0 + ih * 0.5 + fs * 0.36);
    } else {
      c.textAlign = 'center';
      c.fillText('prodevly', X + W / 2, y0 + ih * 0.5 + fs * 0.36);
    }
    c.textAlign = 'left';
  } else if (L.k === 'label') {
    const fs = Math.round(ih * 0.3);
    setFont(c, 880, fs, F_DISP, 'expanded');
    c.fillText(L.t, x0, y0 + ih * 0.5 + fs * 0.36);
    const tw = c.measureText(L.t).width;
    c.fillRect(x0 + tw + fs * 0.7, y0 + ih * 0.5, Math.max(0, iw - tw - fs * 3.6), Math.max(2, ih * 0.03));
    setFont(c, 560, Math.round(ih * 0.15), F_MONO);
    c.textAlign = 'right';
    c.fillText('ADDED IN ADMIN', x0 + iw, y0 + ih * 0.5 + ih * 0.055);
    c.textAlign = 'left';
  } else if (L.k === 'send') {
    // keep both marks on the flat centre of the dish, clear of the front roll-off
    const sx = x0 + iw * 0.06;
    const sw = iw * 0.88;
    const fs = Math.round(ih * 0.3);
    setFont(c, 880, fs, F_DISP, 'expanded');
    c.fillText('send', sx, y0 + ih * 0.78);
    const is = Math.round(ih * 0.5);
    drawIcon(c, 'enter', sx + sw - is, y0 + ih * 0.08, is, ink);
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

/* ------------------------------------------------------------------ the cast */
// index: 0 space, 1 shift, 2 enter, 3 tab, 4 cmd, 5 esc, 6 opt, 7 fn, 8 artisan
const CAST = [
  { id: 'space', u: 6.25, h: 0.5, col: 'chalk', ink: HEX.graphite, rough: 0.66, glow: '#FFE7A8', ppu: 230, dish: 0.03, tilt: 0 },
  { id: 'shift', u: 2.25, h: 0.6, col: 'graphite', ink: HEX.chalk, rough: 0.48, glow: '#8FD8C0', ppu: 280 },
  { id: 'enter', u: 2.25, h: 0.6, col: 'tomato', ink: HEX.chalk, rough: 0.62, glow: '#FF6A4D', ppu: 380 },
  { id: 'tab', u: 1.5, h: 0.6, col: 'mint', ink: HEX.graphite, rough: 0.66, glow: '#8FD8C0', ppu: 300 },
  { id: 'cmd', u: 1.25, h: 0.6, col: 'yolk', ink: HEX.graphite, rough: 0.64, glow: '#F6C12B', ppu: 300, tilt: -0.02 },
  { id: 'esc', u: 1, h: 0.6, col: 'chalk', ink: HEX.tomato, rough: 0.68, glow: '#FFE7A8', ppu: 300, tilt: 0.02 },
  { id: 'opt', u: 1.25, h: 0.6, col: 'graphite', ink: HEX.yolk, rough: 0.48, glow: '#F6C12B', ppu: 300 },
  { id: 'fn', u: 1, h: 0.6, col: 'cobalt', ink: HEX.chalk, rough: 0.62, glow: '#6F8BFF', ppu: 300 },
  { id: 'art', u: 1, h: 0.8, art: true, glow: '#8FD8C0' },
];

// legends per section [hero, services, projects, pricing, team, contact]
const KEY = (t, icon) => ({ k: 'key', t, icon });
const LEG = [
  [{ k: 'brand', al: 'r' }, { k: 'brand' }, { k: 'label', t: 'sample work' }, { k: 'brand' }, null, { k: 'brand' }],
  [KEY('shift', 'shift'), { k: 'svc', n: '01', t: ['Web apps'] }, { k: 'proj', n: '02', kind: 'dash' }, KEY('shift', 'shift'), KEY('shift', 'shift'), KEY('shift', 'shift')],
  [KEY('enter', 'enter'), { k: 'svc', n: '03', t: ['Custom software'] }, { k: 'proj', n: '03', kind: 'site' }, KEY('enter', 'enter'), KEY('enter', 'enter'), { k: 'send' }],
  [KEY('tab', 'tab'), { k: 'svc', n: '02', t: ['SaaS'] }, { k: 'proj', n: '01', kind: 'app' }, KEY('tab', 'tab'), KEY('tab', 'tab'), KEY('tab', 'tab')],
  [KEY('cmd', 'cmd'), { k: 'svc', n: '04', t: ['Mobile', 'apps'] }, { k: 'proj', n: '04', kind: 'shop', panel: HEX.yolk }, KEY('cmd', 'cmd'), { k: 'num', t: '2' }, KEY('cmd', 'cmd')],
  [KEY('esc'), { k: 'svc', n: '05', t: ['UI/UX', 'design'] }, KEY('esc'), KEY('esc'), { k: 'num', t: '1' }, KEY('esc')],
  [KEY('opt', 'opt'), { k: 'svc', n: '06', t: ['Cloud &', 'DevOps'] }, KEY('opt', 'opt'), KEY('opt', 'opt'), { k: 'num', t: '4' }, KEY('opt', 'opt')],
  [KEY('fn'), KEY('fn'), KEY('fn'), KEY('fn'), { k: 'num', t: '5' }, KEY('fn')],
  [null, null, null, null, null, null],
];
// which service each cap carries (index into services list) for the typing highlight
const SVC_OF_CAP = [-1, 0, 2, 1, 3, 4, 5, -1, -1];
// idle attention only visits stacked caps; the bar and the loose fn stay unlit
const CAIRN_ORDER = [1, 6, 3, 4, 5, 8, 2];
// sleeves, left to right (desktop) / back to front (phone): tab 01, shift 02, enter 03, cmd 04
const FEATURE_ORDER = [3, 1, 2, 4];
const SHELF = [5, 4, 8, 6, 7];
// real keyboard -> cap (any other key presses a cap picked from its code)
const CODE_CAP = {
  Space: 0, ShiftLeft: 1, ShiftRight: 1, Enter: 2, NumpadEnter: 2, Tab: 3, MetaLeft: 4, MetaRight: 4,
  ControlLeft: 4, ControlRight: 4, Escape: 5, AltLeft: 6, AltRight: 6, Fn: 7, CapsLock: 7,
};

/* ------------------------------------------------------------------ poses
   [x, y(ground the cap rests on), z, rxDeg, ryDeg, rzDeg, scale, blob(0/1)]
   y is the support height; the resting y is solved from the rotated footprint. */
const P = (x, g, z, rx, ry, rz, s = 1, b = 1) => [x, g, z, rx, ry, rz, s, b];

// the cairn: space base, shift + opt side by side, enter bridging them, then tab, cmd, esc
// and the resin artisan on top, each tipped a few degrees toward the viewer so the dished,
// printed tops read as keycaps; fn rests behind the bar like a fallen stone.
function cairn(phone) {
  return [
    P(0, 0, 0, 0, -4, 0),
    P(-1.32, 0.5, 0.03, 0, 6, 0, 1, 0),
    P(0.12, 1.1, -0.02, 2, -6, 0, 1, 0),
    P(-0.1, 1.7, 0.04, 7, 15, 2.2, 1, 0),
    P(0.04, 2.31, 0.02, 5, -10, -1.6, 1, 0),
    P(-0.08, 2.92, 0.04, 9, 19, 2.4, 1, 0),
    P(1.36, 0.5, -0.02, 0, -9, 0, 1, 0),
    phone ? P(7, 0, -5, 0, 30, 0) : P(2.75, 0, -1.7, 0, 22, 0),
    P(-0.02, 3.55, 0.06, 6, -8, -2.5, 1, 0),
  ];
}

function services(phone) {
  if (phone) {
    // compact three-row block with the spacebar as its front row, like the desktop board
    return [
      P(-0.55, 0, 2.25, 0, 0, 0),
      P(-0.95, 0, -1.05, 0, 0, 0),
      P(-0.95, 0, 0, 0, 0, 0),
      P(1.0, 0, -1.05, 0, 0, 0),
      P(0.85, 0, 0, 0, 0, 0),
      P(-1.6, 0, 1.05, 0, 0, 0),
      P(-0.45, 0, 1.05, 0, 0, 0),
      P(0.68, 0, 1.05, 0, 0, 0),
      P(1.72, 0, 1.05, 0, 0, 0),
    ];
  }
  const ox = -0.2;
  return [
    P(0.1 + ox, 0, 1.02, 0, 0, 0),
    P(-1.75 + ox, 0, -1.02, 0, 0, 0),
    P(-1.5 + ox, 0, 0, 0, 0, 0),
    P(0.125 + ox, 0, -1.02, 0, 0, 0),
    P(0.25 + ox, 0, 0, 0, 0, 0),
    P(1.375 + ox, 0, -1.02, 0, 0, 0),
    P(1.5 + ox, 0, 0, 0, 0, 0),
    P(2.375 + ox, 0, -1.02, 0, 0, 0),
    P(2.62 + ox, 0, 0, 0, 0, 0),
  ];
}

const SLEEVE = 72; // common lean of a record leaning back in its bin
function projects(phone) {
  if (phone) {
    // a record crate: four sleeves one behind the other, the spacebar as the front lip.
    // Loose caps wait fully off frame so the crate owns the phone.
    return [
      P(-0.75, 0, 3.2, 0, 0, 0),
      P(0.24, 0, -0.75, SLEEVE, 0, 0),
      P(-0.2, 0, 0.6, SLEEVE, 0, 0),
      P(0.5, 0, -2.1, SLEEVE, 0, 0),
      P(-0.44, 0, 1.95, SLEEVE, 0, 0),
      P(-8, 0, -3, 0, -18, 0),
      P(8, 0, -3.5, 0, 30, 0),
      P(-8.5, 0, -1, 0, 26, 0),
      P(8.5, 0, -1.5, 0, 14, 0),
    ];
  }
  // one shelf: four sleeves on a single line, all leaning back against the spacebar lip
  return [
    P(0, 0, 1.2, 0, 0, 0),
    P(-1.095, 0, 0, SLEEVE, 0, 0),
    P(1.335, 0, 0, SLEEVE, 0, 0),
    P(-3.15, 0, 0, SLEEVE, 0, 0),
    P(3.265, 0, 0, SLEEVE, 0, 0),
    P(-11, 0, -1.5, 0, -18, 0),
    P(11.5, 0, -2.4, 0, 30, 0),
    P(-11.5, 0, 0.8, 0, 26, 0),
    P(-12.5, 0, 2.4, 0, 14, 0),
  ];
}

// small = esc + fn, medium = tab + cmd + artisan, large = space + shift + enter + opt
function pricing(phone) {
  if (phone) {
    // plates stacked down the screen: small (back), medium, large (front)
    return [
      P(0, 0.34, 3.82, 0, 0, 0),
      P(-1.85, 0.34, 2.75, 0, 0, 0),
      P(0.5, 0.34, 2.75, 0, 0, 0),
      P(-0.72, 0.34, -0.47, 0, 0, 0),
      P(0.78, 0.34, -0.47, 0, 0, 0),
      P(-0.55, 0.34, -3.75, 0, 0, 0),
      P(2.35, 0.34, 2.75, 0, 0, 0),
      P(0.55, 0.34, -3.75, 0, 0, 0),
      P(0, 0.34, 0.6, 0, 0, 0),
    ];
  }
  return [
    P(3.9, 0.34, 0.52, 0, 0, 0),
    P(2.05, 0.34, -0.55, 0, 0, 0),
    P(4.4, 0.34, -0.55, 0, 0, 0),
    P(-3.05, 0.34, -0.55, 0, 0, 0),
    P(-1.55, 0.34, -0.55, 0, 0, 0),
    P(-6.62, 0.34, 0.475, 0, 0, 0),
    P(6.25, 0.34, -0.55, 0, 0, 0),
    P(-5.5, 0.34, 0.475, 0, 0, 0),
    P(-2.3, 0.34, 0.52, 0, 0, 0),
  ];
}
const PLATES_DESK = [
  [-6.06, 0.475, 2.5, 1.55],
  [-2.3, 0, 3.75, 2.5],
  [3.9, 0, 6.85, 2.5],
];
const PLATES_PHONE = [
  [0, -3.75, 2.5, 1.55],
  [0, 0.08, 3.6, 2.5],
  [0, 3.3, 6.85, 2.5],
];

function team(phone) {
  return [
    P(0, 0, 0, 0, 0, 0),
    phone ? P(-0.2, 0, -8.5, 0, 22, 0) : P(-9.2, 0, -2.6, 0, 22, 0),
    phone ? P(-2.8, 0, -11.5, 0, -18, 0) : P(8.6, 0, -2.2, 0, -18, 0),
    phone ? P(-7, 0, 4.4, 0, -14, 0) : P(-7.4, 0, 2.4, 0, -14, 0),
    P(-1.22, 0.5, 0.02, 0, 0, 0, 1, 0),
    P(-2.48, 0.5, 0.02, 0, 0, 0, 1, 0),
    P(1.22, 0.5, 0.02, 0, 0, 0, 1, 0),
    P(2.48, 0.5, 0.02, 0, 0, 0, 1, 0),
    P(0, 0.5, 0.02, 0, 0, 0, 1, 0),
  ];
}

function contact(phone) {
  if (phone) {
    // the giant Enter alone, with a small crescent of three caps in front of it
    return [
      P(-13, 0, -4, 0, -6, 0),
      P(-7.5, 0, -3, 0, 24, 0),
      P(0, 0, 0, 0, -10, 0, 2.4),
      P(-2.05, 0, 2.55, 0, -16, 0),
      P(0.9, 0, 2.6, 0, 18, 0),
      P(-7.5, 0, 0.8, 0, 30, 0),
      P(7.5, 0, -2.4, 0, -22, 0),
      P(7.8, 0, 1.0, 0, 12, 0),
      P(-0.72, 0, 3.15, 0, -14, 0),
    ];
  }
  return [
    P(-19, 0, -3, 0, -24, 0),
    P(4.6, 0, -3.6, 0, 20, 0),
    P(0, 0, 0, 0, -12, 0, 2.6),
    P(-3.7, 0, 2.2, 0, -14, 0),
    P(4.1, 0, 1.4, 0, 18, 0),
    P(4.9, 0, -2.4, 0, 30, 0),
    P(5.3, 0, 0.1, 0, -22, 0),
    P(3.1, 0, 3.0, 0, 12, 0),
    P(-1.4, 0, 2.9, 0, -18, 0),
  ];
}

/* camera per section: [tx, ty, tz, dist, azDeg, elDeg, shiftX, shiftY] */
const CAM_DESK = [
  [0.1, 1.95, 0.2, 15.5, 17, 24, 0.36, -0.08],
  [0.2, 0.1, 0.0, 15.5, -24, 52, -0.3, 0.02],
  [0.1, 0.55, 0.5, 13.6, -24, 18, 0.12, -0.24],
  [0.0, 0.1, 0.0, 20.5, -14, 32, 0.0, -0.18],
  [0.0, 0.7, 0.0, 9.5, -8, 17, 0.0, -0.12],
  [0.5, 1.0, 0.0, 17.5, -12, 27, 0.3, -0.04],
];
const CAM_PHONE = [
  [0.0, 1.85, 0.2, 21.5, 50, 16, 0.0, -0.15],
  [0.1, 0.1, -0.2, 21, -24, 56, 0.0, 0.05],
  [0.0, 0.6, 0.5, 15.5, -14, 32, 0.0, 0.1],
  [0.0, 0.1, 0.0, 30, 0, 60, 0.0, -0.03],
  [0.8, 0.7, 0.0, 13.5, 66, 14, 0.0, 0.02],
  [0.0, 1.0, 0.0, 22.5, -14, 30, 0.0, 0.12],
];

/* ------------------------------------------------------------------ module */
export function create(ctx) {
  const { THREE, scene, camera, renderer, overlay, helpers } = ctx;
  const { band, window01, clamp, lerp } = helpers;
  _v3 = new THREE.Vector3();
  _c1 = new THREE.Color();
  _c2 = new THREE.Color();

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);

  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };

  /* ---------- field: full-screen key-grid sweep */
  const fieldCols = FIELD.map((n) => new THREE.Color(HEX[n]));
  const fieldMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: new THREE.Color(HEX.cobalt) },
        uB: { value: new THREE.Color(HEX.chalk) },
        uW: { value: 0 },
        uDir: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCell: { value: 100 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: `
        uniform vec3 uA; uniform vec3 uB; uniform float uW; uniform float uDir; uniform vec2 uRes; uniform float uCell;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec2 px = vUv * uRes;
          float cell = uCell;
          float row = floor(px.y / cell);
          float stag = mod(row, 4.0);
          float off = (stag == 0.0 ? 0.0 : stag == 1.0 ? 0.5 : stag == 2.0 ? 0.75 : 0.25) * cell;
          float x = px.x + off;
          float col = floor(x / cell);
          vec2 local = vec2(fract(x / cell), fract(px.y / cell)) - 0.5;
          vec2 cc = vec2((col + 0.5) * cell - off, (row + 0.5) * cell) / uRes;
          float along = mix(cc.x, 1.0 - cc.x, uDir);
          float thr = along * 0.74 + (1.0 - cc.y) * 0.1 + hash(vec2(col, row)) * 0.08;
          float s = clamp((uW * 1.06 - thr) / 0.14, 0.0, 1.0);
          float hs = s * 0.62;
          float rad = min(0.16, hs);
          float aa = 1.5 / cell;
          vec2 q = abs(local) - vec2(max(hs - rad, 0.0));
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
          float inside = (1.0 - smoothstep(-aa, aa, d)) * step(0.0001, s);
          // keycap: the top face sits inset and lifted, the darker skirt shows below it
          float rimW = 0.085 * (1.0 - smoothstep(0.55, 1.0, s));
          vec2 lt = local - vec2(0.0, rimW * 0.55);
          float hsT = max(hs - rimW, 0.0);
          float radT = min(0.12, hsT);
          vec2 qt = abs(lt) - vec2(max(hsT - radT, 0.0));
          float dt = length(max(qt, 0.0)) + min(max(qt.x, qt.y), 0.0) - radT;
          float topF = 1.0 - smoothstep(-aa, aa, dt);
          vec3 colB = mix(uB * 0.8, uB, max(topF, step(rimW, 0.0001)));
          gl_FragColor = vec4(mix(uA, colB, inside), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const fieldGeo = track(new THREE.PlaneGeometry(2, 2));
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.frustumCulled = false;
  field.renderOrder = -1000;
  scene.add(field);

  /* ---------- lights */
  const hemi = new THREE.HemisphereLight('#ffffff', '#2340C8', 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#FFF4E6', 2.15);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 50;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 0.9);
  scene.add(rim);
  scene.add(rim.target);

  /* ---------- floor shadow catcher */
  const floorGeo = track(new THREE.PlaneGeometry(80, 80));
  const floorMat = track(new THREE.ShadowMaterial({ color: '#0b1660', opacity: 0.32, depthWrite: false }));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  scene.add(floor);

  /* ---------- shared textures (pool mesh is created after glowTex below) */
  function radialTex(inner, outer, a0) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(64, 64, inner, 64, 64, outer);
    g.addColorStop(0, `rgba(255,255,255,${a0})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a0 * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return track(t);
  }
  const blobTex = radialTex(10, 64, 1);
  const glowTex = radialTex(4, 64, 1);
  const gradCv = document.createElement('canvas');
  gradCv.width = 4;
  gradCv.height = 64;
  {
    const c = gradCv.getContext('2d');
    const g = c.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.12, '#6a6a6a');
    g.addColorStop(0.26, '#000000');
    g.addColorStop(1, '#000000');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 64);
  }
  const gradTex = track(new THREE.CanvasTexture(gradCv));
  gradTex.channel = 2;
  // ambient occlusion by height: caps darken toward the surface they stand on
  const aoCv = document.createElement('canvas');
  aoCv.width = 4;
  aoCv.height = 64;
  {
    const c = aoCv.getContext('2d');
    const g = c.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, '#5c5c5c');
    g.addColorStop(0.18, '#a8a8a8');
    g.addColorStop(0.45, '#f2f2f2');
    g.addColorStop(1, '#ffffff');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 64);
  }
  const aoTex = track(new THREE.CanvasTexture(aoCv));
  aoTex.channel = 2;
  // PBT grain: fine value noise used as a faint bump
  const grainCv = document.createElement('canvas');
  grainCv.width = grainCv.height = 128;
  {
    const c = grainCv.getContext('2d');
    const img = c.createImageData(128, 128);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = 110 + ((seed / 2147483647) * 60) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  const grainTex = track(new THREE.CanvasTexture(grainCv));
  grainTex.colorSpace = THREE.NoColorSpace;
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.repeat.set(3, 3);
  grainTex.channel = 1;

  const poolMat = track(
    new THREE.MeshBasicMaterial({ map: glowTex, color: HEX.chalk, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  const poolGeo = track(new THREE.PlaneGeometry(1, 1));
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.renderOrder = 1;
  pool.visible = false;
  scene.add(pool);

  /* ---------- caps */
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  scene.add(root);
  const blobGeo = track(new THREE.PlaneGeometry(1, 1));
  blobGeo.rotateX(-Math.PI / 2);

  const caps = CAST.map((spec, i) => {
    const geo = track(
      keycapGeometry(THREE, {
        u: spec.u,
        h: spec.h,
        dish: spec.dish ?? (spec.art ? 0.07 : 0.06),
        rTop: spec.art ? 0.2 : 0.13,
        rBot: spec.art ? 0.16 : 0.1,
        bevel: spec.art ? 0.11 : 0.065,
        taperX: spec.art ? 0.13 : 0.1,
        taperF: spec.art ? 0.13 : 0.13,
        taperB: spec.art ? 0.13 : 0.06,
        tilt: spec.tilt ?? 0,
      }),
    );
    const ud = geo.userData;
    let mat;
    let tex = null;
    let tiles = null;
    let tileOf = null;
    let cv = null;
    if (spec.art) {
      mat = track(
        new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          roughness: 0.07,
          metalness: 0,
          transmission: 1,
          thickness: 0.45,
          ior: 1.42,
          attenuationColor: new THREE.Color('#BFF3E2'),
          attenuationDistance: 1.4,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          specularIntensity: 1,
          envMapIntensity: 1.25,
          emissive: new THREE.Color(spec.glow),
          emissiveMap: gradTex,
          emissiveIntensity: 0,
        }),
      );
    } else {
      // legend atlas: one tile per unique legend for this cap
      const uniq = [];
      tileOf = LEG[i].map((L) => {
        const key = JSON.stringify(L);
        let k = uniq.indexOf(key);
        if (k < 0) {
          uniq.push(key);
          k = uniq.length - 1;
        }
        return k;
      });
      tiles = uniq.map((s) => JSON.parse(s));
      const tw = Math.round(ud.hw0 * 2 * spec.ppu);
      const th = Math.round(ud.hd0 * 2 * spec.ppu);
      cv = document.createElement('canvas');
      cv.width = tw;
      cv.height = th * tiles.length;
      tex = track(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.repeat.set(1, 1 / tiles.length);
      tex.offset.set(0, (tiles.length - 1) / tiles.length);
      mat = track(
        new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          map: tex,
          roughness: spec.rough,
          metalness: 0,
          clearcoat: 0.0001,
          clearcoatRoughness: 0.22,
          aoMap: aoTex,
          aoMapIntensity: 1,
          bumpMap: grainTex,
          bumpScale: 0.35,
          envMapIntensity: spec.col === 'graphite' ? 0.6 : 0.28,
          emissive: new THREE.Color(spec.glow),
          emissiveMap: gradTex,
          emissiveIntensity: 0,
        }),
      );
    }
    mat.envMap = scene.environment;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = !spec.art;
    mesh.rotation.order = 'YXZ';
    inner.add(mesh);

    // contact blob + underglow (siblings so they stay on the support plane)
    const blobMat = track(
      new THREE.MeshBasicMaterial({ map: blobTex, color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }),
    );
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.renderOrder = 2;
    inner.add(blob);
    const glowMat = track(
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: new THREE.Color(spec.glow),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const glow = new THREE.Mesh(blobGeo, glowMat);
    glow.renderOrder = 3;
    inner.add(glow);

    return { spec, i, geo, mat, mesh, tex, cv, tiles, tileOf, ud, blob, blobMat, glow, glowMat, curTile: -1 };
  });

  // inner "P" monogram suspended in the resin artisan
  const art = caps[8];
  {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0.1, 0);
    sh.lineTo(0.1, 0.14);
    sh.lineTo(0.16, 0.14);
    sh.absarc(0.16, 0.27, 0.13, -Math.PI / 2, Math.PI / 2, false);
    sh.lineTo(0, 0.4);
    sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(0.1, 0.215);
    hole.lineTo(0.16, 0.215);
    hole.absarc(0.16, 0.27, 0.055, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(0.1, 0.325);
    hole.closePath();
    sh.holes.push(hole);
    const pg = track(
      new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.014, bevelSegments: 3, curveSegments: 14 }),
    );
    pg.center();
    const pm = track(new THREE.MeshStandardMaterial({ color: HEX.tomato, roughness: 0.38, metalness: 0, emissive: new THREE.Color(HEX.tomato), emissiveIntensity: 0.12 }));
    pm.envMap = scene.environment;
    pm.envMapIntensity = 0.4;
    const pMesh = new THREE.Mesh(pg, pm);
    pMesh.position.set(0, 0.33, -0.02);
    pMesh.scale.setScalar(0.72);
    pMesh.rotation.y = 0.3;
    pMesh.castShadow = false;
    art.mesh.add(pMesh);
    art.inner = pMesh;
  }

  function paintLegends() {
    for (const cap of caps) {
      if (!cap.cv) continue;
      const c = cap.cv.getContext('2d');
      const tw = cap.cv.width;
      const th = cap.cv.height / cap.tiles.length;
      c.fillStyle = HEX[cap.spec.col];
      c.fillRect(0, 0, cap.cv.width, cap.cv.height);
      const pr = cap.ud.print;
      cap.tiles.forEach((L, k) => {
        if (!L) return;
        const X = pr.x0 * tw;
        const Y = k * th + pr.y0 * th;
        const W = (pr.x1 - pr.x0) * tw;
        const H = (pr.y1 - pr.y0) * th;
        drawLegend(c, L, X, Y, W, H, cap.spec.ink);
      });
      cap.tex.needsUpdate = true;
    }
  }
  paintLegends();
  const ENV = scene.environment;

  /* ---------- pose tables */
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const m4 = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  function solve(table) {
    // returns Float32Array rows: x,y,z,rx,ry,rz,s,blob,groundY,bw,bd
    return table.map((p, i) => {
      const cap = caps[i];
      const { hw0, hd0, h } = cap.ud;
      const s = p[6];
      euler.set(p[3] * D2R, 0, p[5] * D2R, 'YXZ');
      m4.makeRotationFromEuler(euler);
      let minY = Infinity;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const sx of [-1, 1])
        for (const sy of [0, 1])
          for (const sz of [-1, 1]) {
            corner.set(sx * hw0, sy * h, sz * hd0).applyMatrix4(m4);
            if (corner.y < minY) minY = corner.y;
            x0 = Math.min(x0, corner.x);
            x1 = Math.max(x1, corner.x);
            z0 = Math.min(z0, corner.z);
            z1 = Math.max(z1, corner.z);
          }
      const y = p[1] - minY * s;
      return Float32Array.from([p[0], y, p[2], p[3] * D2R, p[4] * D2R, p[5] * D2R, s, p[7], p[1], (x1 - x0) * s, (z1 - z0) * s, ((x0 + x1) / 2) * s, ((z0 + z1) / 2) * s]);
    });
  }
  const build = (phone) => [cairn(phone), services(phone), projects(phone), pricing(phone), team(phone), contact(phone)].map(solve);
  const POSE = { desk: build(false), phone: build(true) };
  const STAGGER = [0, 3, 1, 5, 2, 6, 4, 7, 8];
  const LIFT = [0.9, 1.8, 1.4, 2.4, 2.1, 2.8, 1.6, 2.2, 3.2];

  /* ---------- plates (pricing) */
  const plateMat = track(new THREE.MeshPhysicalMaterial({ color: HEX.graphite, metalness: 0.6, roughness: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.55 }));
  const plateTopMat = track(new THREE.MeshStandardMaterial({ color: '#2A2D34', metalness: 0.2, roughness: 0.7, envMapIntensity: 0.3 }));
  plateMat.envMap = ENV;
  plateTopMat.envMap = ENV;
  const plates = PLATES_DESK.map((p, i) => {
    const g = track(new RoundedBoxGeometry(p[2], 0.34, p[3], 4, 0.09));
    const m = new THREE.Mesh(g, plateMat);
    m.castShadow = true;
    m.receiveShadow = true;
    const inset = track(new RoundedBoxGeometry(p[2] - 0.32, 0.04, p[3] - 0.32, 2, 0.02));
    const im = new THREE.Mesh(inset, plateTopMat);
    im.position.y = 0.165;
    im.receiveShadow = true;
    m.add(im);
    inner.add(m);
    const blobMat = track(new THREE.MeshBasicMaterial({ map: blobTex, color: '#000000', transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.renderOrder = 2;
    inner.add(blob);
    return { m, blob, blobMat, i };
  });

  /* ---------- overlay */
  const navKeys = [
    ['Services', 'chalk', HEX.graphite],
    ['Work', 'yolk', HEX.graphite],
    ['Pricing', 'mint', HEX.graphite],
    ['Team', 'tomato', SIDE.graphite],
    ['Contact', 'graphite', HEX.chalk],
  ];
  const svcNames = ['Web apps', 'SaaS products', 'Custom software', 'Mobile apps', 'UI/UX design', 'Cloud & DevOps'];
  overlay.innerHTML = `
  <div class="keys-ov" data-dark="1">
    <header class="keys-nav">
      <span class="keys-brand"><i></i>ProDevly</span>
      <span class="keys-navkeys">${navKeys
        .map(([t, c, i]) => `<span class="keys-nk" style="--c:${HEX[c]};--s:${SIDE[c]};--i:${i};--led:${FIELD_DARK[FIELD.indexOf(c)] ? HEX.mint : HEX.graphite}">${t}<b></b></span>`)
        .join('')}</span>
      <span class="keys-key keys-navcta"><span>Start a project</span>${ENTER_SVG}</span>
      <span class="keys-menu">Menu</span>
    </header>

    <section class="keys-s keys-hero">
      <p class="keys-idx">For founders, businesses &amp; agencies</p>
      <h1 class="keys-h1">Web apps, SaaS and custom software, built end to end.</h1>
      <p class="keys-lede">Design, code and launch, handled by one team.</p>
      <span class="keys-key keys-cta"><span>Start a project</span>${ENTER_SVG}</span>
      <p class="keys-hint"><span class="keys-mini">A</span>Type on your keyboard. The keys press back.</p>
    </section>

    <section class="keys-s keys-svc">
      <p class="keys-idx">01 / Services</p>
      <h2 class="keys-h2">What we build</h2>
      <p class="keys-body">Each key is one kind of work we take on, from the first screen to the servers it runs on.</p>
      <ul class="keys-svclist">${svcNames.map((n) => `<li>${n.replace('&', '&amp;')}</li>`).join('')}</ul>
    </section>
    <div class="keys-s keys-card keys-card--white" data-card="1">
      <span class="keys-mono">Six services, one team</span>
      <p>Web apps · SaaS products · Custom software · Mobile apps · UI/UX design · Cloud &amp; DevOps</p>
    </div>

    <section class="keys-s keys-proj">
      <p class="keys-idx">02 / Work</p>
      <h2 class="keys-h2">Projects</h2>
      <p class="keys-body keys-desk">These sleeves are samples. Real case studies appear here once they are published from the admin.</p>
      <div class="keys-tagrow"><span class="keys-tag">Sample content</span></div>
    </section>
    <div class="keys-s keys-card keys-card--graphite" data-card="2">
      <span class="keys-mono">Sample sleeves</span>
      <p>Case studies appear here once they are published from the admin.</p>
    </div>

    <section class="keys-s keys-price">
      <p class="keys-idx">03 / Pricing</p>
      <h2 class="keys-h2">Pick a size of build</h2>
      <p class="keys-body keys-desk">Small, medium or large. Plan names and prices are set in the admin.</p>
    </section>
    ${['Small', 'Medium', 'Large']
      .map((s) => `<div class="keys-plan"><b>${s}</b><em>Sample plan</em><span>Price set in admin</span></div>`)
      .join('')}
    <div class="keys-s keys-card keys-card--graphite" data-card="3">
      <span class="keys-mono" style="color:#8FD8C0">Small · Medium · Large</span>
      <p>Sample plan sizes. Plan names and prices are set in the admin.</p>
    </div>

    <section class="keys-s keys-team">
      <p class="keys-idx">04 / Developers</p>
      <h2 class="keys-h2">The people at the keys</h2>
    </section>
    ${[1, 2, 3, 4, 5].map((n) => `<div class="keys-dev"><b>Developer</b>Sample slot 0${n}</div>`).join('')}
    <div class="keys-s keys-card keys-card--chalk" data-card="4">
      <span class="keys-mono">Sample slots</span>
      <p>Developer profiles are added in the admin, one key per person.</p>
    </div>

    <section class="keys-s keys-contact">
      <p class="keys-idx">05 / Contact</p>
      <h2 class="keys-h2">Tell us what you're building.</h2>
      <div class="keys-form">
        <div class="keys-field">Name</div>
        <div class="keys-field">Email</div>
        <div class="keys-field keys-field--tall">What do you need built?</div>
        <div class="keys-formrow"><span class="keys-fine">The team replies by email.</span><span class="keys-key keys-send"><span>Send</span>${ENTER_SVG}</span></div>
      </div>
    </section>
    <div class="keys-s keys-card keys-card--chalk" data-card="5">
      <span class="keys-mono">Name · Email · Project</span>
      <p>Three fields, then press Enter. The team replies by email.</p>
      <span class="keys-key"><span>Send enquiry</span>${ENTER_SVG}</span>
    </div>

    <div class="keys-colorway">Colorway${FIELD.map((f) => `<i style="--c:${HEX[f]}"></i>`).join('')}</div>
  </div>`;

  const ov = overlay.querySelector('.keys-ov');
  const secEls = [
    ov.querySelector('.keys-hero'),
    ov.querySelector('.keys-svc'),
    ov.querySelector('.keys-proj'),
    ov.querySelector('.keys-price'),
    ov.querySelector('.keys-team'),
    ov.querySelector('.keys-contact'),
  ];
  const cardEls = [null, 1, 2, 3, 4, 5].map((k) => (k ? ov.querySelector(`[data-card="${k}"]`) : null));
  const nkEls = [...ov.querySelectorAll('.keys-nk')];
  const swEls = [...ov.querySelectorAll('.keys-colorway i')];
  const svcLis = [...ov.querySelectorAll('.keys-svclist li')];
  const planEls = [...ov.querySelectorAll('.keys-plan')];
  const devEls = [...ov.querySelectorAll('.keys-dev')];
  const lastOp = new Float32Array(16).fill(-1);
  let lastSection = -1;
  let lastDark = -1;
  let lastSvc = -2;
  let W = 1;
  let H = 1;
  let phoneMode = ctx.isPhone;
  ov.classList.toggle('is-phone', phoneMode);

  /* ---------- fonts: repaint legends once the faces really load */
  let disposed = false;
  (async () => {
    const want = ['Hubot Sans', 'Martian Mono', 'Mona Sans'];
    for (let n = 0; n < 60 && !disposed; n++) {
      try {
        await Promise.all([
          document.fonts.load("880 64px 'Hubot Sans'"),
          document.fonts.load("600 64px 'Martian Mono'"),
          document.fonts.load("500 64px 'Mona Sans'"),
        ]);
      } catch (e) {
        /* keep polling */
      }
      const loaded = new Set();
      document.fonts.forEach((f) => {
        if (f.status === 'loaded') loaded.add(f.family.replace(/["']/g, ''));
      });
      if (want.every((w) => loaded.has(w))) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!disposed) paintLegends();
  })();

  /* ---------- the visitor's keyboard presses the matching cap */
  const keyT = new Float32Array(9).fill(-100);
  let nowT = 0;
  function onKey(e) {
    if (ctx.reducedMotion || e.repeat) return;
    let i = CODE_CAP[e.code];
    if (i === undefined) {
      const c = e.code || e.key || '';
      let hsh = 7;
      for (let k = 0; k < c.length; k++) hsh = (hsh * 31 + c.charCodeAt(k)) | 0;
      i = 1 + (Math.abs(hsh) % 8);
    }
    keyT[i] = nowT;
  }
  window.addEventListener('keydown', onKey);

  /* ---------- rhythm helpers (deterministic in time) */
  function pressCurve(t) {
    if (t < 0) return 0;
    if (t < 0.05) return t / 0.05;
    const k = t - 0.05;
    return Math.exp(-k * 11) * Math.cos(k * 19);
  }
  const TYPE_SEQ = [1, 5, 3, 6, 4, 2, 3, 1, 7, 5, 2, 6];
  const BEAT = 0.34;

  function setOp(i, el, v, dy) {
    if (!el) return;
    const q = Math.round(v * 200) / 200;
    if (lastOp[i] === q) return;
    lastOp[i] = q;
    el.style.opacity = String(q);
    el.style.transform = `translate3d(0, ${((1 - q) * dy).toFixed(2)}cqh, 0)`;
    el.style.visibility = q <= 0 ? 'hidden' : 'visible';
  }

  function placeLabel(el, x, y, z, vis, dyPx, ax = 0.5, ay = 0) {
    if (vis <= 0.001) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
      return;
    }
    _v3.set(x, y, z);
    inner.localToWorld(_v3);
    _v3.project(camera);
    const sx = (_v3.x * 0.5 + 0.5) * W;
    const sy = (-_v3.y * 0.5 + 0.5) * H + dyPx;
    el.style.opacity = vis.toFixed(3);
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(${-ax * 100}%, ${-ay * 100}%)`;
  }

  const cam = new Float32Array(8);
  const camA = new Float32Array(8);
  const camB = new Float32Array(8);

  function update({ progress, time, pointer, isPhone }) {
    if (isPhone !== phoneMode) {
      phoneMode = isPhone;
      ov.classList.toggle('is-phone', phoneMode);
      lastOp.fill(-1);
    }
    const p = clamp(progress, 0, 1);
    const tt = ctx.reducedMotion ? 0 : time;
    nowT = tt;
    const seg = Math.min(4, Math.floor(p / 0.2 + 1e-6));
    const base = seg * 0.2;
    const poses = isPhone ? POSE.phone : POSE.desk;
    const A = poses[seg];
    const B = poses[seg + 1];
    const camT = isPhone ? CAM_PHONE : CAM_DESK;

    /* --- camera */
    const ct = band(p, base + 0.015, base + 0.185);
    for (let k = 0; k < 8; k++) {
      camA[k] = camT[seg][k];
      camB[k] = camT[seg + 1][k];
      cam[k] = lerp(camA[k], camB[k], ct);
    }
    // projects: sideways dolly through the chapter
    // (phone holds still: the crate is centred and owns the frame)
    const dolly = isPhone ? 0 : (band(p, 0.3, 0.5) - 0.5) * 2.6 * window01(p, 0.33, 0.47, 0.08);
    const tx = cam[0] + dolly;
    const ty = cam[1];
    const tz = cam[2];
    const az = (cam[4] + pointer.x * 1.0) * D2R;
    const el = (cam[5] + pointer.y * 0.8) * D2R;
    camera.position.set(tx + cam[3] * Math.cos(el) * Math.sin(az), ty + cam[3] * Math.sin(el), tz + cam[3] * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, tz);
    camera.updateProjectionMatrix();
    const e = camera.projectionMatrix.elements;
    e[8] = -cam[6];
    e[9] = -cam[7];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();

    /* --- pointer tilt of the totem (damped upstream, +-6deg) */
    root.position.set(tx, ty, tz);
    inner.position.set(-tx, -ty, -tz);
    root.rotation.y = pointer.x * 0.1;
    root.rotation.x = -pointer.y * 0.04;

    /* --- section weights */
    const wHero = window01(p, -1, 0.03, 0.06);
    const wSvc = window01(p, 0.17, 0.23, 0.06);
    const wProj = window01(p, 0.37, 0.43, 0.06);
    const wTeam = window01(p, 0.77, 0.83, 0.06);
    const wCon = window01(p, 0.97, 2, 0.06);
    // team caps take an artisan-grade clearcoat while they stand on the shelf
    const wGloss = band(p, 0.68, 0.78) * (1 - band(p, 0.82, 0.9));

    /* --- typing rhythm (services) */
    const beatI = Math.floor(tt / BEAT);
    const beatT = tt - beatI * BEAT;
    const typed = TYPE_SEQ[beatI % TYPE_SEQ.length];
    const rest = beatI % 8 === 7; // breath between words
    let svcOn = -1;
    if (wSvc > 0.5 && !rest) svcOn = SVC_OF_CAP[typed];

    /* --- hero attention: one cairn cap lit from beneath at a time */
    const att = tt / 1.7;
    const attI = Math.floor(att) % CAIRN_ORDER.length;
    const attF = att - Math.floor(att);
    const attLit = CAIRN_ORDER[attI];
    const attAmt = Math.sin(Math.PI * clamp(attF * 1.15, 0, 1));

    // with a live pointer, the caps nearest it light instead (projected cap centres)
    const pointerLive = Math.abs(pointer.x) + Math.abs(pointer.y) > 0.04 && wHero > 0.01;
    if (pointerLive) {
      root.updateMatrixWorld();
      camera.updateMatrixWorld();
    }

    /* --- contact Enter press cycle */
    const conT = tt % 2.4;
    const conPress = pressCurve(conT - 0.9);
    const conGlow = 0.35 + 0.65 * clamp(1 - (conT - 0.9) / 1.4, 0, 1) * (conT > 0.9 ? 1 : 0);

    /* --- caps */
    for (let i = 0; i < caps.length; i++) {
      const cap = caps[i];
      const a = A[i];
      const b = B[i];
      const st = STAGGER[i] * 0.011;
      const t0 = base + 0.02 + st;
      const t1 = Math.min(base + 0.2 - 0.008, base + 0.12 + st);
      const t = band(p, t0, t1);
      const arc = Math.sin(Math.PI * t);
      const lift = arc * LIFT[i] * (seg === 3 || seg === 2 ? 0.75 : 1);
      let x = lerp(a[0], b[0], t);
      let y = lerp(a[1], b[1], t) + lift;
      let z = lerp(a[2], b[2], t) + arc * 0.6;
      let rx = lerp(a[3], b[3], t) + arc * 0.5 * (i % 2 ? 1 : -1);
      let ry = lerp(a[4], b[4], t) + arc * 0.7 * (i % 3 === 0 ? 1 : -1);
      let rz = lerp(a[5], b[5], t) + arc * 0.25 * (i % 2 ? -1 : 1);
      const s = lerp(a[6], b[6], t);

      // hero: breathing wobble, growing toward the top of the cairn
      const hw = wHero * (1 - t);
      if (hw > 0 && i !== 0 && i !== 2 && i !== 7) {
        const lvl = a[1] / 3;
        rz += Math.sin(tt * 0.9) * 0.012 * lvl * hw;
        x += Math.sin(tt * 0.9) * 0.03 * lvl * hw;
        ry += Math.sin(tt * 0.5 + i) * 0.012 * hw;
      }

      // services: keys press in a typing rhythm
      let press = 0;
      if (wSvc > 0 && i === typed && !rest) press = pressCurve(beatT) * wSvc;
      // team: the focal artisan bobs
      if (wTeam > 0 && i === 8) y += Math.sin(tt * 1.4) * 0.05 * wTeam;
      // projects: the featured sleeve tilts forward, one at a time
      if (wProj > 0) {
        const fi = FEATURE_ORDER[Math.floor(tt / 2.6) % 4];
        if (i === fi) {
          const f = Math.sin(Math.PI * clamp(((tt % 2.6) / 2.6) * 1.25, 0, 1));
          const k = f * wProj;
          // pulled up out of the bin and turned toward the viewer
          rx -= (isPhone ? 0.3 : 0.38) * k;
          y += (isPhone ? 0.95 : 0.85) * k;
          z += (isPhone ? 0.2 : 0.12) * k;
        }
      }
      // contact: the giant Enter presses (real travel, springy return)
      if (wCon > 0 && i === 2) press = conPress * wCon * 1.0;

      // the visitor's own keys: travel for caps on the floor, a hop for caps in a stack
      const kp = tt - keyT[i];
      let kpc = 0;
      if (kp >= 0 && kp < 1.4) {
        kpc = pressCurve(kp);
        if (lerp(a[8], b[8], t) > 0.3) y += kpc * 0.2 * s;
        else press += kpc;
      }
      y -= press * 0.13 * s;
      cap.mesh.position.set(x, y, z);
      cap.mesh.rotation.set(rx, ry, rz);
      cap.mesh.scale.setScalar(s);

      // legend tile swaps while the cap is in flight
      if (cap.tex) {
        const ti = cap.tileOf[t < 0.5 ? seg : seg + 1];
        if (ti !== cap.curTile) {
          cap.curTile = ti;
          const n = cap.tiles.length;
          cap.tex.offset.set(0, (n - 1 - ti) / n);
        }
      }

      // contact blob on the support plane
      const g = lerp(a[8], b[8], t);
      const bOn = lerp(a[7], b[7], t) * (1 - clamp(lift / 0.8, 0, 1));
      cap.blob.visible = bOn > 0.01;
      if (cap.blob.visible) {
        const ox = lerp(a[11], b[11], t);
        const oz = lerp(a[12], b[12], t);
        const cy = Math.cos(ry);
        const sy = Math.sin(ry);
        cap.blob.position.set(x + ox * cy + oz * sy, g + 0.004, z - ox * sy + oz * cy + 0.04);
        cap.blob.rotation.y = ry;
        // the long bar gets a tight, darker contact line so it sits rather than hovers
        const bm = i === 0 ? 0.15 : 0.35;
        cap.blob.scale.set(lerp(a[9], b[9], t) * 1.18 + bm, 1, lerp(a[10], b[10], t) * 1.22 + bm);
        cap.blobMat.opacity = (i === 0 ? 0.6 : 0.42) * bOn;
      }

      // underglow: attention is illumination
      let gl = 0;
      if (pointerLive && i !== 0) {
        _v3.set(x, y + cap.ud.h * 0.5 * s, z);
        inner.localToWorld(_v3);
        _v3.project(camera);
        const dx = _v3.x - pointer.x;
        const dy = (_v3.y - pointer.y) * 0.7;
        const near = 1 - clamp(Math.sqrt(dx * dx + dy * dy) / 0.32, 0, 1);
        gl += near * near * wHero;
      } else if (i === attLit) gl += attAmt * wHero * 0.9;
      if (i === typed && !rest) gl += Math.max(0, pressCurve(beatT)) * wSvc;
      if (i === 2) gl += conGlow * wCon * (0.6 + 0.4 * Math.max(0, conPress));
      if (wTeam > 0 && i === 8) gl += 0.45 * wTeam;
      if (kpc > 0) gl += kpc;
      cap.mat.emissiveIntensity = gl * (cap.spec.art ? 0.9 : cap.spec.col === 'chalk' ? 0.7 : 1.6);
      if (!cap.spec.art) {
        const gw = SHELF.indexOf(i) >= 0 ? wGloss : 0;
        // a satin coat only: a sharper clearcoat mirrors the room light and bleaches the colour
        cap.mat.roughness = lerp(cap.spec.rough, 0.5, gw);
        cap.mat.clearcoat = 0.0001 + 0.16 * gw;
        cap.mat.clearcoatRoughness = 0.22 + 0.3 * gw;
      }
      cap.glow.visible = gl > 0.01 && bOn > 0.5;
      if (cap.glow.visible) {
        cap.glow.position.set(x, g + 0.01, z);
        cap.glow.rotation.y = ry;
        cap.glow.scale.set((cap.ud.hw0 * 2 + 0.45) * s, 1, (cap.ud.hd0 * 2 + 0.45) * s);
        cap.glowMat.opacity = clamp(gl, 0, 1) * 0.9;
      }
    }
    if (art.inner) art.inner.rotation.y = 0.3 + Math.sin(tt * 0.6) * 0.25;

    /* --- plates slide in for pricing, out after */
    const PL = isPhone ? PLATES_PHONE : PLATES_DESK;
    const pin = band(p, 0.43, 0.56);
    const pout = band(p, 0.64, 0.77);
    for (let k = 0; k < plates.length; k++) {
      const pl = plates[k];
      const d = PL[k];
      const kin = clamp(pin * 1.3 - k * 0.12, 0, 1);
      const kout = clamp(pout * 1.3 - (2 - k) * 0.12, 0, 1);
      const off = (1 - kin) * 18 - kout * 18;
      const vis = kin > 0 && kout < 1;
      pl.m.visible = vis;
      pl.blob.visible = vis;
      if (!vis) continue;
      const sx = isPhone ? d[0] + off * 0.6 : d[0] + off;
      const sz = isPhone ? d[1] : d[1];
      pl.m.position.set(sx, 0.17, sz);
      pl.m.scale.set(isPhone ? PLATES_PHONE[k][2] / PLATES_DESK[k][2] : 1, 1, isPhone ? PLATES_PHONE[k][3] / PLATES_DESK[k][3] : 1);
      pl.blob.position.set(sx, 0.003, sz + 0.05);
      pl.blob.scale.set(d[2] * 1.15 + 0.6, 1, d[3] * 1.25 + 0.6);
      pl.blobMat.opacity = 0.5;
    }

    /* --- field sweep + coloured bounce */
    const wipe = band(p, base + 0.04, base + 0.16);
    const fu = fieldMat.uniforms;
    fu.uA.value.copy(fieldCols[seg]);
    fu.uB.value.copy(fieldCols[seg + 1]);
    fu.uW.value = wipe;
    fu.uDir.value = seg % 2;
    const fieldNow = wipe < 0.5 ? seg : seg + 1;
    _c1.copy(fieldCols[seg]).lerp(fieldCols[seg + 1], wipe);
    hemi.groundColor.copy(_c1);
    _c2.set('#ffffff').lerp(_c1, 0.35);
    hemi.color.copy(_c2);
    floorMat.color.copy(_c1).multiplyScalar(0.18);
    floorMat.opacity = FIELD_DARK[fieldNow] ? 0.5 : 0.3;
    for (let k = 0; k < caps.length; k++) caps[k].blobMat.color.copy(_c1).multiplyScalar(0.12);

    // key light + shadow box follow the subject
    key.target.position.set(tx, 0, tz);
    key.position.set(tx - 5.5, 13, tz + 5.5);
    rim.target.position.set(tx, 1, tz);
    rim.position.set(tx + 4, 6, tz - 9);
    // contact: graphite on graphite needs a stronger rim and a faint lighter ground
    const wDark = band(p, 0.86, 0.96);
    rim.intensity = lerp(0.9, 1.6, wDark);
    pool.visible = wDark > 0.001;
    if (pool.visible) {
      pool.position.set(0.2, 0.006, 0.4);
      const ps = isPhone ? 11 : 15;
      pool.scale.set(ps, 1, ps * 0.8);
      poolMat.opacity = 0.06 * wDark;
    }

    /* --- overlay */
    const dark = FIELD_DARK[fieldNow];
    if (dark !== lastDark) {
      lastDark = dark;
      ov.dataset.dark = String(dark);
    }
    if (fieldNow !== lastSection) {
      lastSection = fieldNow;
      ov.dataset.field = String(fieldNow);
      for (let k = 0; k < nkEls.length; k++) {
        nkEls[k].classList.toggle('is-on', k + 1 === fieldNow);
        nkEls[k].classList.toggle('is-seen', k + 1 <= fieldNow);
      }
      for (let k = 0; k < swEls.length; k++) swEls[k].classList.toggle('is-on', k === fieldNow);
    }
    if (svcOn !== lastSvc) {
      lastSvc = svcOn;
      for (let k = 0; k < svcLis.length; k++) svcLis[k].classList.toggle('is-on', k === svcOn);
    }
    for (let k = 0; k < 6; k++) {
      const at = k * 0.2;
      const v = window01(p, at - 0.035, at + 0.035, 0.045);
      setOp(k, secEls[k], v, 2.2);
      if (cardEls[k]) setOp(8 + k, cardEls[k], v, 1.4);
    }
    // projected labels: plan labels on both devices, developer chips on desktop
    root.updateMatrixWorld();
    const wPrice = window01(p, 0.575, 0.625, 0.04);
    for (let k = 0; k < 3; k++) {
      const d = PL[k];
      const pp = plates[k].m.position;
      if (isPhone) {
        // a chalk label stuck on the front edge of each plate
        placeLabel(planEls[k], pp.x, 0.3, d[1] + d[3] / 2, wPrice, 0, 0.5, 0.5);
      } else {
        // one common baseline under all three plates
        placeLabel(planEls[k], pp.x, 0, 1.25, wPrice, 16);
      }
    }
    if (!isPhone) {
      const tw = window01(p, 0.775, 0.825, 0.04);
      for (let k = 0; k < 5; k++) {
        const c = caps[SHELF[k]].mesh.position;
        placeLabel(devEls[k], c.x, 0, c.z + 0.75, tw, 8);
      }
      lastOp[15] = 1;
    } else if (lastOp[15] !== 0) {
      lastOp[15] = 0;
      for (const el2 of devEls) el2.style.opacity = '0';
    }
  }

  function resize({ width, height, isPhone }) {
    W = width;
    H = height;
    fieldMat.uniforms.uRes.value.set(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
    const cellCss = isPhone ? width / 4.25 : height / 6.2;
    fieldMat.uniforms.uCell.value = cellCss * renderer.getPixelRatio();
    if (isPhone !== phoneMode) {
      phoneMode = isPhone;
      ov.classList.toggle('is-phone', phoneMode);
      lastOp.fill(-1);
    }
  }

  function dispose() {
    disposed = true;
    window.removeEventListener('keydown', onKey);
    for (const d of disposables) d.dispose?.();
    scene.remove(field, hemi, key, key.target, rim, rim.target, floor, pool, root);
    renderer.shadowMap.enabled = false;
    overlay.innerHTML = '';
  }

  return { update, resize, dispose };
}
