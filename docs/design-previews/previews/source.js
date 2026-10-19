// Live Source — the home page as a running program.
// A source buffer types the next block as you scroll; on the next beat the
// lacquered totems rebuild to match. Same 24 pieces all the way down.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const C = {
  ground: '#140F0D',
  porcelain: '#F3EEE6',
  vermilion: '#E2472B',
  jade: '#3FA38A',
  citrine: '#F2B33D',
  lapis: '#3355C4',
  gold: '#C9A45C',
};

export const meta = {
  id: 'source',
  title: 'Live Source',
  stage: { background: C.ground, fov: 30, exposure: 1 },
  sections: [
    { key: 'hero', label: 'Hero', at: 0 },
    { key: 'services', label: 'Services', at: 0.2 },
    { key: 'projects', label: 'Projects', at: 0.4 },
    { key: 'pricing', label: 'Pricing', at: 0.6 },
    { key: 'team', label: 'Developers', at: 0.8 },
    { key: 'contact', label: 'Contact', at: 1 },
  ],
  fonts: ['Science+Gothic:wdth,wght@50..200,100..900', 'Martian+Mono:wdth,wght@75..112.5,100..800'],
};

/* ------------------------------------------------------------------ copy */

// «value» = the live value that cycles; ‹text› = an empty form string with placeholder.
const BLOCKS = [
  {
    file: 'home.ts',
    run: 6,
    laneNo: 4,
    lines: [
      '// We design, build and ship your product.',
      'const product = prodevly.build({',
      '  type: "web app",',
      '  scope: ["design", "build", "launch"],',
      '  finish: «vermilion»,',
      '});',
      'ship(product);',
    ],
    lane: 'build({ finish: «vermilion» })',
  },
  {
    file: 'services.ts',
    run: 6,
    lines: [
      '// What we build. One line, one piece.',
      'const services = [',
      '  "Web apps",        "SaaS products",',
      '  "Custom software", "Mobile apps",',
      '  "UI/UX design",    "Cloud & DevOps",',
      '];',
      'services.map(build);',
    ],
    lane: 'services.map(build);',
  },
  {
    file: 'work.ts',
    run: 3,
    lines: [
      '// Projects we ship are listed',
      '// here. Samples show until',
      '// real ones are added.',
      'work.forEach(ship);',
    ],
    lane: 'work.forEach(ship);',
  },
  {
    file: 'pricing.ts',
    run: 1,
    lines: [
      '// Pick the size of build that fits.',
      'plan("Sprint" | "Build" | "Platform");',
      '// Sample names. Plan names and prices',
      '// are set in the admin panel.',
    ],
    lane: 'plan("Sprint"|"Build"|"Platform")',
  },
  {
    file: 'team.ts',
    run: 2,
    lines: [
      '// The developers who write your code',
      '// sign their work.',
      'team.forEach(sign);',
      '// Profiles are added in the admin.',
    ],
    lane: 'team.forEach(sign);',
  },
  {
    file: 'contact.ts',
    run: 1,
    lines: [
      '// Tell us what you are building.',
      'await prodevly.start({',
      '  name: ‹Your name›,',
      '  email: ‹you@company.com›,',
      '  project: "Web app",',
      '  message: ‹A few lines about it›,',
      '});',
    ],
    lane: 'await prodevly.start(yourProject);',
  },
];

const HEADS = [
  { eyebrow: '01 / home', title: 'Web apps, SaaS and custom software, built end to end.', hero: true },
  { eyebrow: '02 / services', title: 'What we build' },
  { eyebrow: '03 / projects', title: 'Projects', narrow: true },
  { eyebrow: '04 / pricing', title: 'Pricing' },
  { eyebrow: '05 / developers', title: 'Developers' },
  { eyebrow: '06 / contact', title: 'Start a project' },
];

// Phone card copy (plain English, same facts as the comments).
const CARDS = [
  { body: 'We design, build and ship your product.', cta: true },
  { list: ['Web apps', 'SaaS products', 'Custom software', 'Mobile apps', 'UI/UX design', 'Cloud & DevOps'] },
  { body: 'Projects we ship are listed here. Samples show until real ones are added.' },
  { chips: ['Sprint', 'Build', 'Platform'], body: 'Sample names. Plan names and prices are set in the admin.' },
  { body: 'The developers who write your code sign their work. Profiles are added in the admin.' },
  { form: true },
];

// Section field colours (sRGB) and the ink that reads on each.
const FIELD = [C.vermilion, C.jade, C.lapis, C.citrine, C.porcelain, C.vermilion];
const FIELD_INK = [C.ground, C.ground, C.porcelain, C.ground, C.ground, C.ground];
// Desktop editor/slab width per section (cqw). Projects narrows the editor so the
// deploy rail can run the full width; contact narrows it a little for the bay.
const PW = [46.5, 46.5, 33, 46.5, 46.5, 40];
// Screen row (in buffer lines) where each section's run line lands: the downbeat.
const ROW = [7, 7, 7, 7, 7, 2];
// How much each field's hue bleeds into the floor's sheen pool (lapis kept low so it never reads purple).
const SHEEN_TINT = [0.08, 0.07, 0.022, 0.08, 0.05, 0.08];
const CYCLE = ['vermilion', 'jade', 'citrine', 'lapis'];
const TONE_HEX = { ...C, crown: C.vermilion, goldmark: C.gold };

const SERVICES = ['Web apps', 'SaaS products', 'Custom software', 'Mobile apps', 'UI/UX design', 'Cloud & DevOps'];
const PLANS = ['Sprint', 'Build', 'Platform'];
const MARKS = ['{ }', '</>', '=>', '( )', '[ ]', '#'];

const KW = new Set(['const', 'await', 'for', 'of', 'return', 'let', 'new', 'async']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlight(line) {
  const ci = line.indexOf('//');
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const re = /(«[^»]*»)|(‹[^›]*›)|("[^"]*")|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)|(\s+)|(.)/g;
  let html = '';
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) html += `<span class="source-s source-x">"<b class="source-xv">${esc(m[1].slice(1, -1))}</b>"</span>`;
    else if (m[2]) html += `<span class="source-s source-ph">"${esc(m[2].slice(1, -1))}"</span>`;
    else if (m[3]) html += `<span class="source-s">${esc(m[3])}</span>`;
    else if (m[4]) {
      const w = m[4];
      const next = code[re.lastIndex];
      if (KW.has(w)) html += `<span class="source-k">${w}</span>`;
      else if (next === '(') html += `<span class="source-f">${w}</span>`;
      else html += `<span class="source-v">${w}</span>`;
    } else if (m[5]) html += `<span class="source-n">${m[5]}</span>`;
    else if (m[6]) html += m[6];
    else html += `<span class="source-p">${esc(m[7])}</span>`;
  }
  if (comment) html += `<span class="source-c">${esc(comment)}</span>`;
  return html;
}
const plainLen = (line) => line.replace(/[«»]/g, '"').replace(/[‹›]/g, '"').length;

/* ------------------------------------------------------------------ css */

export const css = `
.source-root{--pw:46.5cqw;position:absolute;inset:0;color:${C.porcelain};font-family:'Martian Mono',ui-monospace,Menlo,monospace;font-stretch:87.5%;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.source-root *{box-sizing:border-box}
.source-display{font-family:'Science Gothic','Anybody',system-ui,sans-serif;font-stretch:130%;font-weight:760;letter-spacing:-.005em}
.source-nav{position:absolute;left:3.2cqw;right:3.2cqw;top:3.6cqh;display:flex;align-items:center;gap:2cqw;z-index:4}
.source-brand{font-family:'Science Gothic','Anybody',system-ui,sans-serif;font-weight:820;font-stretch:160%;font-size:1.42cqw;letter-spacing:.02em;display:flex;align-items:center;gap:.35em}
.source-brand i{display:inline-block;width:.5em;height:.9em;background:${C.citrine};transform:translateY(.04em)}
.source-links{display:flex;gap:2.3cqw;margin-inline:auto;font-size:max(12px,.86cqw);letter-spacing:.02em;color:rgba(243,238,230,.66)}
.source-links span{position:relative;padding-block:.4em}
.source-links span.is-on{color:${C.porcelain}}
.source-links span.is-on::after{content:'';position:absolute;left:0;right:0;bottom:-.1em;height:2px;background:${C.citrine}}
.source-run{background:${C.citrine};color:${C.ground};font-weight:640;font-size:max(12px,.86cqw);letter-spacing:.01em;padding:.8cqw 1.15cqw;border-radius:2px;white-space:nowrap}
.source-burger{display:none}
.source-slab{position:absolute;left:0;top:11.5cqh;width:var(--pw);height:24.5cqh;background:${C.vermilion};overflow:hidden;z-index:2}
.source-navbg{position:absolute;left:0;right:0;top:0;height:11.5cqh;background:${C.ground};z-index:3}
.source-root.is-phone .source-navbg{height:16cqh}
.source-pane{position:absolute;left:0;top:36cqh;bottom:0;width:var(--pw);background:${C.ground};border-right:1px solid rgba(243,238,230,.08);z-index:1}
.source-root.is-phone .source-pane{display:none}
.source-wipe{position:absolute;inset:0;transform-origin:0 50%;transform:scaleX(0);will-change:transform}
.source-head{position:absolute;left:3.2cqw;right:3cqw;top:2.9cqh;bottom:2.6cqh;display:flex;flex-direction:column;justify-content:space-between;will-change:transform,opacity}
.source-eyebrow{display:block;font-size:max(10.5px,.78cqw);letter-spacing:.06em;text-transform:uppercase;margin-bottom:1.7cqh;opacity:.8;font-weight:560}
.source-head .source-eyebrow{margin-bottom:0}
.source-title{margin:0;font-size:4.3cqw;line-height:.96}
.source-head.is-hero .source-title{font-size:2.62cqw;line-height:1.04;font-stretch:122%}
.source-head.is-narrow .source-title{font-size:3.5cqw}
.source-ed{position:absolute;left:3.2cqw;top:39cqh;width:calc(var(--pw) - 3.5cqw);height:45cqh;overflow:hidden;font-size:1.04cqw;z-index:2;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 92%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 92%,transparent 100%)}
.source-buf{position:absolute;left:0;right:0;top:0;will-change:transform}
.source-ln{position:relative;height:2.15em;display:flex;align-items:center;white-space:pre}
.source-no{flex:none;width:4.2ch;color:rgba(243,238,230,.32);font-variant-numeric:tabular-nums}
.source-code{position:relative;width:max-content;line-height:1.3;isolation:isolate}
.source-bar{position:absolute;left:-.8ch;right:-2.8ch;top:-.2em;bottom:-.2em;z-index:-1;background:${C.citrine};border-radius:1px;transform-origin:0 50%;transform:scaleX(0)}
.source-k{color:${C.vermilion}}
.source-s{color:${C.jade}}
.source-n{color:${C.citrine}}
.source-f{color:${C.porcelain};background:${C.lapis};box-shadow:0 0 0 .14em ${C.lapis};border-radius:1px}
.source-v{color:rgba(243,238,230,.9)}
.source-p{color:rgba(243,238,230,.55)}
.source-c{color:${C.porcelain};font-weight:520}
.source-ph{color:rgba(243,238,230,.74);text-decoration:underline dotted rgba(243,238,230,.42);text-decoration-thickness:1px;text-underline-offset:.32em}
.source-x{color:${C.citrine}}
.source-xv{font-weight:inherit;border-bottom:.2em solid ${C.vermilion}}
.source-ln.is-run .source-k,.source-ln.is-run .source-s,.source-ln.is-run .source-n,.source-ln.is-run .source-v,.source-ln.is-run .source-p,.source-ln.is-run .source-c,.source-ln.is-run .source-x{color:${C.ground}}
.source-ln.is-run .source-no{color:${C.citrine}}
.source-caret{position:absolute;left:0;top:0;width:.62em;height:1.25em;background:${C.porcelain};will-change:transform}
.source-caret.is-run{background:${C.ground}}
.source-cta{position:absolute;left:3.2cqw;top:78cqh;display:flex;align-items:center;gap:1.4cqw;z-index:3}
.source-cta b{background:${C.citrine};color:${C.ground};font-weight:660;font-size:1cqw;padding:1.05cqw 1.5cqw;border-radius:2px;white-space:nowrap}
.source-status{position:absolute;left:3.2cqw;width:calc(var(--pw) - 3.5cqw);bottom:3.4cqh;display:flex;gap:2.4cqw;font-size:max(10.5px,.72cqw);letter-spacing:.03em;color:rgba(243,238,230,.6);z-index:3;border-top:1px solid rgba(243,238,230,.12);padding-top:1.4cqh;white-space:nowrap}
.source-status span:last-child{margin-left:auto;color:${C.jade}}
.source-root.is-phone .source-status{display:none}
.source-lbls{position:absolute;inset:0;z-index:1}
.source-lbl{position:absolute;left:0;top:0;will-change:transform,opacity;opacity:0}
.source-lbl>span{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;white-space:nowrap}
.source-tag{background:${C.ground};color:${C.porcelain};font-size:max(11px,.78cqw);letter-spacing:.02em;padding:.45em .7em;border:1px solid rgba(243,238,230,.24);border-radius:2px}
.source-tag em{font-style:normal;color:${C.citrine}}
.source-tag .source-xv{border-bottom-width:.16em}
.source-stem{flex:none;width:1px;height:2.2cqh;background:rgba(243,238,230,.5)}
.source-plan{display:flex;flex-direction:column;align-items:center;gap:.35em;background:${C.ground};padding:.6em .9em;border:1px solid rgba(243,238,230,.2);border-radius:2px}
.source-plan b{font-family:'Science Gothic','Anybody',system-ui,sans-serif;font-stretch:150%;font-weight:780;font-size:1.25cqw;color:${C.porcelain};letter-spacing:.02em}
.source-plan small{font-size:max(10.5px,.8cqw);line-height:1.4;text-align:center;color:rgba(243,238,230,.78);letter-spacing:.02em}
.source-lbl.is-below>span{transform:translate(-50%,0)}
.source-lbl.is-left>span{transform:translate(-100%,-50%);flex-direction:row}
.source-lbl.is-right>span{transform:translate(0,-50%);flex-direction:row}
.source-lbl.is-left .source-stem,.source-lbl.is-right .source-stem{width:2.6cqw;height:1px}
.source-lane,.source-card{display:none}

/* ---------- phone ---------- */
.source-root.is-phone .source-nav{left:5.5cqw;right:5.5cqw;top:3.2cqh}
.source-root.is-phone .source-brand{font-size:4.6cqw}
.source-root.is-phone .source-links,.source-root.is-phone .source-nav .source-run{display:none}
.source-root.is-phone .source-burger{display:flex;flex-direction:column;gap:1.4cqw;margin-left:auto;width:7cqw}
.source-root.is-phone .source-burger i{display:block;height:2px;background:${C.porcelain}}
.source-root.is-phone .source-burger i:last-child{width:62%;margin-left:auto}
.source-root.is-phone .source-slab,.source-root.is-phone .source-ed,.source-root.is-phone .source-cta{display:none}
.source-root.is-phone .source-lane{display:block;position:absolute;left:5.5cqw;right:5.5cqw;top:10.4cqh;height:5.6cqh;overflow:hidden;background:${C.citrine};color:${C.ground};border-radius:2px;z-index:3}
.source-lane-track{position:absolute;left:0;right:0;top:0;will-change:transform}
.source-lane-ln{height:5.6cqh;display:flex;align-items:center;gap:2.2cqw;padding-inline:3cqw;font-size:3.25cqw;white-space:pre;font-weight:560}
.source-lane-ln i{font-style:normal;opacity:.6;font-variant-numeric:tabular-nums}
.source-lane-ln .source-f{color:${C.porcelain}}
.source-lane-ln .source-k,.source-lane-ln .source-s,.source-lane-ln .source-n,.source-lane-ln .source-v,.source-lane-ln .source-p,.source-lane-ln .source-x{color:${C.ground}}
.source-root.is-phone .source-card{display:block;position:absolute;left:0;right:0;bottom:0;height:39cqh;background:${C.vermilion};z-index:3}
.source-cc{position:absolute;left:6cqw;right:6cqw;top:3.6cqh;will-change:transform,opacity}
.source-cc .source-eyebrow{font-size:2.8cqw;margin-bottom:1.6cqh}
.source-cc .source-title{font-size:9.6cqw;line-height:.98;margin-bottom:2cqh}
.source-cc.is-hero .source-title{font-size:6.5cqw;line-height:1.06;font-stretch:118%}
.source-cc p{margin:0;font-size:3.3cqw;line-height:1.6;font-weight:500}
.source-cc .source-cbtn{display:inline-block;margin-top:2.6cqh;background:${C.ground};color:${C.porcelain};font-size:3.4cqw;font-weight:620;padding:3cqw 4.2cqw;border-radius:2px}
.source-cc ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:1.8cqh 2.6cqw;font-size:3.15cqw;line-height:1.28;font-weight:540}
.source-cc li{display:flex;align-items:flex-start;gap:1.8cqw}
.source-gl{flex:none;display:flex;flex-direction:column-reverse;gap:.55cqw;padding:.8cqw;background:${C.ground};border-radius:1px;margin-top:.2em}
.source-gl b{display:block;width:2.8cqw;height:1.15cqw;border-radius:.5cqw}
.source-chips{display:flex;flex-wrap:wrap;align-items:center;gap:2cqw;margin-bottom:2cqh}
.source-chips span{font-family:'Science Gothic','Anybody',system-ui,sans-serif;font-stretch:150%;font-weight:780;font-size:3.7cqw;letter-spacing:.02em;background:${C.ground};color:${C.porcelain};padding:1.6cqw 2.6cqw;border-radius:2px}
.source-chips em{font-style:normal;font-size:2.9cqw;opacity:.8}
.source-form{display:grid;gap:.8cqh;font-size:3.1cqw}
.source-cc[data-i="5"] .source-title{margin-bottom:1.4cqh}
.source-cc[data-i="5"] .source-cbtn{margin-top:2cqh}
.source-form span{display:flex;justify-content:space-between;border-bottom:1.5px solid currentColor;padding-bottom:.7cqh}
.source-form span em{font-style:normal;opacity:.72}
.source-root.is-phone .source-tag{font-size:3.1cqw}
.source-root.is-phone .source-plan b{font-size:3.9cqw}
.source-root.is-phone .source-stem{height:2cqh}
.source-root.is-phone .source-lbl.is-left .source-stem,.source-root.is-phone .source-lbl.is-right .source-stem{width:1.8cqw;height:1px}
`;

/* ------------------------------------------------------------------ geometry */

function roundedProfile(THREE, pts, r, seg = 7) {
  const out = [new THREE.Vector2(pts[0][0], pts[0][1])];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    let ax = px - cx;
    let ay = py - cy;
    let bx = nx - cx;
    let by = ny - cy;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const rr = Math.min(r, la * 0.48, lb * 0.48);
    const p0x = cx + ax * rr, p0y = cy + ay * rr;
    const p1x = cx + bx * rr, p1y = cy + by * rr;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const x = (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * cx + t * t * p1x;
      const y = (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * cy + t * t * p1y;
      out.push(new THREE.Vector2(Math.max(0, x), y));
    }
  }
  const last = pts[pts.length - 1];
  out.push(new THREE.Vector2(last[0], last[1]));
  return out;
}

// Contact occlusion baked per vertex. Every piece rests on something, so the
// bottom band darkens into the crevice; flat-topped pieces also darken toward the
// centre of their top face, where the next piece sits. Written twice: as a vertex
// colour (darkens albedo under direct light) and as uv1 into a 1D ramp aoMap
// (darkens env diffuse, specular and clearcoat, so the crevice reads in the gloss).
function bakeAO(THREE, geo, h, flatTop, floor = 0.34) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const uv1 = new Float32Array(n * 2);
  const bb = Math.min(0.1, h * 0.42);
  const ss = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const rad = Math.hypot(pos.getX(i), pos.getZ(i));
    let ao = floor + (1 - floor) * ss(0, bb, y);
    if (flatTop) ao *= 0.48 + 0.52 * Math.max(ss(0, bb * 0.7, h - y), ss(0.2, 0.62, rad));
    const c = 1 - (1 - ao) * 0.55;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
    uv1[i * 2] = ao;
    uv1[i * 2 + 1] = 0.5;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

function makeKinds(THREE) {
  const lathe = (pts, r, h, flat = false, fl) => {
    const geo = new THREE.LatheGeometry(roundedProfile(THREE, pts, r), 72);
    bakeAO(THREE, geo, h, flat, fl);
    return { geo, h };
  };
  const drum = (R, H, r, fl) => lathe([[0, 0], [R, 0], [R, H], [0, H]], r, H, true, fl);
  const torus = (R, t) => {
    const geo = new THREE.TorusGeometry(R, t, 28, 72).rotateX(Math.PI / 2).translate(0, t, 0);
    bakeAO(THREE, geo, t * 2, false);
    return { geo, h: t * 2 };
  };
  const bead = (R) => {
    const geo = new THREE.SphereGeometry(R, 56, 36).translate(0, R, 0);
    bakeAO(THREE, geo, R * 2, false, 0.42);
    return { geo, h: R * 2 };
  };
  const rboxGeo = new RoundedBoxGeometry(0.86, 0.5, 0.86, 5, 0.1).translate(0, 0.25, 0);
  bakeAO(THREE, rboxGeo, 0.5, true);
  // the one asymmetric element: a lapis beam cantilevered off the axis
  const beamGeo = new THREE.CapsuleGeometry(0.11, 0.96, 10, 32).rotateZ(Math.PI / 2).translate(0.3, 0.11, 0);
  bakeAO(THREE, beamGeo, 0.22, false, 0.62);
  return {
    drumW: drum(0.62, 0.42, 0.09),
    drum: drum(0.5, 0.4, 0.085),
    drumS: drum(0.46, 0.38, 0.08),
    spacer: drum(0.44, 0.075, 0.03, 0.62),
    plate: drum(0.74, 0.14, 0.055),
    plateS: drum(0.62, 0.12, 0.05),
    coin: lathe([[0, 0], [0.36, 0], [0.36, 0.085], [0, 0.085]], 0.03, 0.085, false, 0.55),
    onion: lathe([[0, 0], [0.4, 0], [0.5, 0.1], [0.56, 0.3], [0.36, 0.58], [0.15, 0.7], [0, 0.72]], 0.14, 0.72),
    frustum: lathe([[0, 0], [0.58, 0], [0.3, 0.52], [0, 0.52]], 0.07, 0.52),
    frustumS: lathe([[0, 0], [0.5, 0], [0.25, 0.5], [0, 0.5]], 0.065, 0.5),
    dome: lathe([[0, 0], [0.54, 0], [0.54, 0.1], [0.42, 0.38], [0.2, 0.52], [0, 0.54]], 0.16, 0.54),
    domeS: lathe([[0, 0], [0.46, 0], [0.46, 0.08], [0.36, 0.32], [0.17, 0.44], [0, 0.46]], 0.14, 0.46),
    hourglass: lathe([[0, 0], [0.5, 0], [0.22, 0.32], [0.5, 0.64], [0, 0.64]], 0.1, 0.64, true),
    ring: torus(0.4, 0.16),
    ringS: torus(0.34, 0.14),
    bead: bead(0.34),
    beadS: bead(0.3),
    rbox: { geo: rboxGeo, h: 0.5 },
    beam: { geo: beamGeo, h: 0.22 },
  };
}

// The pool. Index = identity; the same objects play every chapter.
const POOL = [
  ['drumW', 'lapis'], // 0
  ['spacer', 'gold'], // 1
  ['onion', 'jade'], // 2
  ['plate', 'porcelain'], // 3
  ['frustum', 'citrine'], // 4
  ['ring', 'vermilion'], // 5
  ['spacer', 'gold'], // 6
  ['dome', 'crown'], // 7  the one high-gloss hero, its finish cycles
  ['rbox', 'citrine'], // 8
  ['bead', 'lapis'], // 9
  ['drum', 'jade'], // 10
  ['hourglass', 'vermilion'], // 11
  ['domeS', 'citrine'], // 12
  ['plateS', 'lapis'], // 13
  ['frustumS', 'porcelain'], // 14
  ['ringS', 'jade'], // 15
  ['drumS', 'vermilion'], // 16
  ['beadS', 'porcelain'], // 17
  ['coin', 'goldmark'], // 18..23 maker's marks
  ['coin', 'goldmark'],
  ['coin', 'goldmark'],
  ['coin', 'goldmark'],
  ['coin', 'goldmark'],
  ['coin', 'goldmark'],
  ['beam', 'lapis'], // 24  cantilever: breaks the vertical axis in hero and contact
];
const N = POOL.length;
// ring under the frustum, crown on a gold spacer on the cantilevered beam
const HERO = [0, 1, 2, 3, 5, 4, 24, 6, 7];
const SIX = [
  [0, 3, 7], // Web apps
  [10, 1, 12], // SaaS products
  [8, 15, 9], // Custom software
  [13, 2, 17], // Mobile apps
  [16, 6, 4], // UI/UX design
  [11, 5, 14], // Cloud & DevOps
];
const TIERS = [
  [10, 1, 7],
  [0, 6, 8, 15, 3, 9],
  [13, 16, 4, 5, 2, 11, 14, 17, 12],
];
const CONTACT = [0, 1, 2, 3, 'slot', 13, 5, 4, 24, 6, 7];
const SLOT_H = 0.62;
const RAIL_H = 0.24;

/* ------------------------------------------------------------------ textures */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function smudgeTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(232,232,232)';
  g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 90; i++) {
    const x = r() * 256, y = r() * 256, rad = 8 + r() * 46;
    const v = r() < 0.5 ? 255 : 185;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${v},${v},${v},${0.18 + r() * 0.2})`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 14;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, img.data[i] + n));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// 4x2 atlas of engraved gold maker's marks: colour, roughness and metalness.
function markAtlas(THREE) {
  const W = 1024, H = 512, cell = 256;
  const mk = (base, glyph, ring) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    MARKS.forEach((m, i) => {
      const cx = (i % 4) * cell + cell / 2;
      const cy = Math.floor(i / 4) * cell + cell / 2;
      if (typeof base === 'string') {
        g.fillStyle = base;
        g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      } else {
        const gr = g.createRadialGradient(cx - 30, cy - 30, 10, cx, cy, cell * 0.6);
        gr.addColorStop(0, base[0]);
        gr.addColorStop(1, base[1]);
        g.fillStyle = gr;
        g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      }
      g.strokeStyle = ring;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, cell * 0.4, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = glyph;
      g.font = '800 124px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(m, cx, cy + 6);
    });
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  };
  const map = mk(['#EBCB88', '#C29A52'], '#2B1C0A', '#4F3715');
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = mk('rgb(64,64,64)', 'rgb(225,225,225)', 'rgb(200,200,200)');
  const metal = mk('rgb(255,255,255)', 'rgb(90,90,90)', 'rgb(120,120,120)');
  return { map, rough, metal };
}

function buildEnvironment(THREE, renderer) {
  const s = new THREE.Scene();
  const disposables = [];
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 18, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#2b211c'), side: THREE.BackSide }),
  );
  room.position.y = 6;
  s.add(room);
  disposables.push(room);
  const panel = (w, h, k, hex, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 1, 0);
    s.add(m);
    disposables.push(m);
  };
  panel(9, 6, 5.5, '#FFF2E2', -9, 9, 7); // key softbox, top left front
  panel(1.3, 12, 5, '#F6F0E8', 4, 6, -12); // rim strip behind
  panel(1, 10, 2.6, '#FFE6C6', 13, 4, 2); // warm side strip
  panel(16, 2.4, 1.3, '#F3EEE6', 0, 13, -2); // ceiling bar
  panel(6, 1.2, 1.1, '#F2B33D', -2, 0.2, 12); // low citrine bounce card
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture;
  pm.dispose();
  disposables.forEach((m) => {
    m.geometry.dispose();
    m.material.dispose();
  });
  return tex;
}

/* ------------------------------------------------------------------ floor */

// The Reflector renders the mirrored scene into its target; two separable
// gaussian passes (below) blur it into a third target, and this shader reads that
// once. No per-pixel noise, so the lacquer stays smooth, never grainy.
const FloorShader = {
  name: 'UrushiFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uBg: { value: null },
    uStrength: { value: 0.3 },
    uRadius: { value: 6 },
    uSheen: { value: null },
    uPool: { value: null },
    uPoolR: { value: 3.2 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 uBg;
    uniform vec3 uSheen;
    uniform vec2 uPool;
    uniform float uPoolR;
    uniform float uStrength;
    uniform float uRadius;
    varying vec4 vUv;
    varying vec3 vW;
    #include <logdepthbuf_pars_fragment>
    vec3 tm(vec3 c) {
      #ifdef TONE_MAPPING
      return toneMapping(c);
      #else
      return c;
      #endif
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec3 r = texture2D(tDiffuse, vUv.xy / vUv.w).rgb;
      float fade = 1.0 - smoothstep(uRadius * 0.25, uRadius, length(vW.xz - uPool));
      float pool = 1.0 - smoothstep(0.0, uPoolR, length(vW.xz - uPool - vec2(-0.45, 0.55)));
      vec3 col = uBg + (tm(r) - tm(uBg)) * uStrength * fade + uSheen * pool * pool;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
      #include <colorspace_fragment>
    }`,
};

// 13-tap separable gaussian (sigma = 3 taps; uDir sets the tap spacing). The
// horizontal pass also clamps fireflies from the clearcoat highlights.
const BLUR_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLUR_FS = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uDir; uniform float uClamp; varying vec2 vUv;
  void main(){
    vec3 c = vec3(0.0); float ws = 0.0;
    for (int i = -6; i <= 6; i++) {
      float fi = float(i);
      float w = exp(-fi * fi / 18.0);
      c += w * min(texture2D(tSrc, vUv + uDir * fi).rgb, vec3(uClamp));
      ws += w;
    }
    gl_FragColor = vec4(c / ws, 1.0);
  }`;

/* ------------------------------------------------------------------ module */

// scratch (no allocation in update)
const _v = { x: 0, y: 0, z: 0 };
const _a = { x: 0, y: 0, z: 0, s: 1, ry: 0, on: 0, order: 0 };
const _b = { x: 0, y: 0, z: 0, s: 1, ry: 0, on: 0, order: 0 };
const AT = [0, 0.2, 0.4, 0.6, 0.8, 1];

export function create(ctx) {
  const { THREE, scene, camera, renderer, overlay, helpers } = ctx;
  const { band, clamp, lerp } = helpers;
  const V3 = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const disposables = [];
  const own = (x) => (disposables.push(x), x);

  /* ---- environment + light ---- */
  const env = buildEnvironment(THREE, renderer);
  const prevEnv = scene.environment;
  scene.environment = env;
  scene.environmentIntensity = 1;

  const key = new THREE.DirectionalLight('#FFF0DE', 2.3);
  key.position.set(-5, 7.5, 6);
  const rim = new THREE.DirectionalLight('#FFF4EA', 2.6);
  rim.position.set(4, 5, -7);
  const rim2 = new THREE.DirectionalLight('#F2B33D', 0.7);
  rim2.position.set(-6, 2, -5);
  const hemi = new THREE.HemisphereLight('#F3EEE6', '#140F0D', 0.42);
  // low front fill so camera-facing flats (the rounded box) keep their jewel tone
  const fill = new THREE.DirectionalLight('#FFF4E8', 0.55);
  fill.position.set(1, 2.5, 9);
  const slotLight = new THREE.PointLight('#F5BE52', 0, 0.9, 2);
  scene.add(key, rim, rim2, hemi, fill, slotLight);

  /* ---- floor (urushi lacquer table) ---- */
  const floor = new Reflector(new THREE.PlaneGeometry(60, 60), {
    shader: FloorShader,
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.002,
    multisample: 0,
  });
  floor.rotation.x = -Math.PI / 2;
  const fu = floor.material.uniforms;
  fu.uBg.value = new THREE.Color(C.ground);
  fu.uSheen.value = new THREE.Color();
  fu.uPool.value = new THREE.Vector2();
  const sheenBase = new THREE.Color('#2a1d16').multiplyScalar(1.1);
  const fieldLin = FIELD.map((hex) => new THREE.Color(hex));
  scene.add(floor);

  // separable blur of the reflection: raw -> rtB (horizontal) -> rtC (vertical)
  const rtRaw = floor.getRenderTarget();
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
  const rtB = own(new THREE.WebGLRenderTarget(2, 2, rtOpts));
  const rtC = own(new THREE.WebGLRenderTarget(2, 2, rtOpts));
  const blurMat = (src) =>
    own(
      new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: src.texture }, uDir: { value: new THREE.Vector2() }, uClamp: { value: 1.4 } },
        vertexShader: BLUR_VS,
        fragmentShader: BLUR_FS,
        depthTest: false,
        depthWrite: false,
      }),
    );
  const blurH = blurMat(rtRaw);
  const blurV = blurMat(rtB);
  const blurQuad = new THREE.Mesh(own(new THREE.PlaneGeometry(2, 2)), blurH);
  blurQuad.frustumCulled = false;
  const blurScene = new THREE.Scene();
  blurScene.add(blurQuad);
  const blurCam = new THREE.Camera();
  fu.tDiffuse.value = rtC.texture;
  const reflect = floor.onBeforeRender;
  floor.onBeforeRender = function (r, sc, cam, geo, mat, group) {
    reflect.call(this, r, sc, cam, geo, mat, group);
    const prev = r.getRenderTarget();
    blurQuad.material = blurH;
    r.setRenderTarget(rtB);
    r.render(blurScene, blurCam);
    blurQuad.material = blurV;
    r.setRenderTarget(rtC);
    r.render(blurScene, blurCam);
    r.setRenderTarget(prev);
  };

  /* ---- contact shadows: one instanced draw ---- */
  const shadowGeo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const shadowOpacity = new Float32Array(N + 1);
  shadowGeo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(shadowOpacity, 1));
  const shadowMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTint: { value: new THREE.Color('#030201') } },
      vertexShader: /* glsl */ `
        attribute float aOpacity; varying float vO; varying vec2 vUv;
        void main(){ vUv = uv; vO = aOpacity; vec4 p = vec4(position,1.0);
          #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint; varying float vO; varying vec2 vUv;
        void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = length(q);
          float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.7) * vO;
          gl_FragColor = vec4(uTint, a); }`,
    }),
  );
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, N + 1);
  shadows.frustumCulled = false;
  shadows.renderOrder = 2;
  shadows.position.y = 0.004;
  scene.add(shadows);
  const shM = new THREE.Matrix4();
  const shQ = new THREE.Quaternion();
  const shS = new THREE.Vector3();
  const shP = new THREE.Vector3();

  /* ---- materials ---- */
  const smudge = own(smudgeTexture(THREE));
  // 1D ramp read through uv1: the baked contact occlusion as an aoMap
  const ramp = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    ramp[i * 4] = ramp[i * 4 + 1] = ramp[i * 4 + 2] = i;
    ramp[i * 4 + 3] = 255;
  }
  const aoRamp = own(new THREE.DataTexture(ramp, 256, 1));
  aoRamp.channel = 1;
  aoRamp.magFilter = aoRamp.minFilter = THREE.LinearFilter;
  aoRamp.needsUpdate = true;
  const AO = { vertexColors: true, aoMap: aoRamp, aoMapIntensity: 1 };
  const lacquer = (hex) =>
    own(
      new THREE.MeshPhysicalMaterial({
        color: hex,
        roughness: 0.42,
        roughnessMap: smudge,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.14,
        clearcoatRoughnessMap: smudge,
        ...AO,
      }),
    );
  const mats = {
    vermilion: lacquer(C.vermilion),
    jade: lacquer(C.jade),
    citrine: lacquer(C.citrine),
    lapis: lacquer(C.lapis),
    // the rounded box's flat faces need a tighter gloss to catch the softboxes
    citrineBox: lacquer(C.citrine),
    porcelain: own(
      new THREE.MeshPhysicalMaterial({
        color: C.porcelain,
        roughness: 0.62,
        roughnessMap: smudge,
        clearcoat: 0.35,
        clearcoatRoughness: 0.38,
        ...AO,
      }),
    ),
    gold: own(
      new THREE.MeshStandardMaterial({ color: C.gold, metalness: 1, roughness: 0.3, roughnessMap: smudge, ...AO }),
    ),
    // rail, posts and caps carry no baked attributes
    goldPlain: own(
      new THREE.MeshStandardMaterial({ color: C.gold, metalness: 1, roughness: 0.3, roughnessMap: smudge }),
    ),
    crown: own(
      new THREE.MeshPhysicalMaterial({
        color: C.vermilion,
        roughness: 0.16,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.025,
        ...AO,
      }),
    ),
  };
  mats.citrineBox.roughness = 0.3;
  mats.citrineBox.clearcoatRoughness = 0.08;
  const atlas = markAtlas(THREE);
  [atlas.map, atlas.rough, atlas.metal].forEach(own);
  const markMat = own(
    new THREE.MeshStandardMaterial({
      map: atlas.map,
      roughnessMap: atlas.rough,
      metalnessMap: atlas.metal,
      roughness: 1,
      metalness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  const cycleColors = CYCLE.map((k) => new THREE.Color(C[k]));

  /* ---- pieces ---- */
  const kinds = makeKinds(THREE);
  Object.values(kinds).forEach((k) => own(k.geo));
  const root = new THREE.Group();
  scene.add(root);
  const pieces = POOL.map(([kind, tone], i) => {
    const k = kinds[kind];
    const mat = tone === 'goldmark' ? mats.gold : kind === 'rbox' ? mats.citrineBox : mats[tone];
    const mesh = new THREE.Mesh(k.geo, mat);
    mesh.userData = { h: k.h, r: kind.startsWith('plate') ? 0.7 : kind === 'coin' ? 0.32 : 0.55 };
    if (tone === 'goldmark') {
      const mi = i - 18;
      const dg = own(new THREE.CircleGeometry(0.3, 48).rotateX(-Math.PI / 2));
      const uv = dg.attributes.uv;
      const row = Math.floor(mi / 4);
      for (let j = 0; j < uv.count; j++) uv.setXY(j, ((mi % 4) + uv.getX(j)) / 4, (uv.getY(j) - row) / 2 + 0.5);
      uv.needsUpdate = true;
      const decal = new THREE.Mesh(dg, markMat);
      decal.position.y = k.h + 0.002;
      mesh.add(decal);
    }
    root.add(mesh);
    return mesh;
  });

  // gold rail for the deploy chapter
  const railGeo = own(new RoundedBoxGeometry(9.6, RAIL_H, 0.66, 4, 0.07).translate(0, RAIL_H / 2, 0));
  const rail = new THREE.Mesh(railGeo, mats.goldPlain);
  scene.add(rail);

  // gold posts that frame the empty slot in the contact chapter
  const postGeo = own(new THREE.CylinderGeometry(0.052, 0.052, 1, 24).translate(0, 0.5, 0));
  const posts = new THREE.InstancedMesh(postGeo, mats.goldPlain, 3);
  posts.frustumCulled = false;
  scene.add(posts);
  const capGeo = own(new THREE.SphereGeometry(0.082, 24, 16));
  const caps = new THREE.InstancedMesh(capGeo, mats.goldPlain, 3);
  caps.frustumCulled = false;
  scene.add(caps);
  const postM = new THREE.Matrix4();
  const postP = new THREE.Vector3();
  const postS = new THREE.Vector3();

  const poolMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(C.citrine) }, uO: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 uColor; uniform float uO; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6) * uO; gl_FragColor = vec4(uColor, a); }',
    }),
  );
  const poolGeo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const slotPool = new THREE.Mesh(poolGeo, poolMat);
  slotPool.renderOrder = 3;
  scene.add(slotPool);
  const hazeMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#F5B547') }, uO: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 uColor; uniform float uO; varying vec2 vUv; void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = length(q * vec2(1.0, 1.25)); float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.0) * uO; gl_FragColor = vec4(uColor * a, 1.0); }',
    }),
  );
  const haze = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), hazeMat);
  haze.renderOrder = 4;
  scene.add(haze);

  /* ---- chapter layouts (same pieces, six arrangements) ---- */
  const blank = () => ({ x: 0, y: 0, z: 0, s: 1, ry: 0, on: 0, order: 0 });
  function stack(cfg, ids, x, z, s, y0 = 0, ry = 0, slotH = SLOT_H) {
    let y = y0;
    let o = 0;
    for (const id of ids) {
      if (id === 'slot') {
        y += slotH * s;
        continue;
      }
      const p = cfg.p[id];
      p.x = x; p.y = y; p.z = z; p.s = s; p.ry = ry; p.on = 1; p.order = o++;
      y += pieces[id].userData.h * s;
    }
    return y;
  }
  function layouts(phone) {
    const L = AT.map(() => ({ p: Array.from({ length: N }, blank), tops: [], bases: [] }));
    // 0 hero
    stack(L[0], HERO, 0, 0, 1);
    // 1 services: desktop, one shallow arc of six; phone, a 3x2 grid (the card mirrors it)
    const sv = phone
      ? [[-1.12, -0.55], [0, -0.55], [1.12, -0.55], [-1.12, 0.75], [0, 0.75], [1.12, 0.75]]
      : SIX.map((_, i) => [(i - 2.5) * 0.92, -Math.abs(i - 2.5) * 0.22]);
    const svS = phone ? 0.62 : 0.6;
    SIX.forEach((ids, i) => {
      const top = stack(L[1], ids, sv[i][0], sv[i][1], svS, 0, i * 0.7);
      L[1].tops.push([sv[i][0], top, sv[i][1]]);
    });
    // 2 projects: up on the gold rail, a deploy log
    const pjS = phone ? 0.54 : 0.62;
    SIX.forEach((ids, i) => {
      const x = (i - 2.5) * (phone ? 1.05 : 1.26);
      const top = stack(L[2], ids, x, 0, pjS, RAIL_H, i * 0.5);
      L[2].tops.push([x, top, 0]);
    });
    L[2].drift = true;
    // 3 pricing: three tiers of growing complexity
    const tx = phone ? [-1.0, 0, 1.0] : [-1.38, 0.05, 1.48];
    const tS = phone ? 0.56 : 0.66;
    TIERS.forEach((ids, i) => {
      const top = stack(L[3], ids, tx[i], 0, tS, 0, i * 0.4);
      L[3].tops.push([tx[i], top, 0]);
      L[3].bases.push([tx[i], 0, 0]);
    });
    // 4 team: a ring; each totem gets a gold maker's mark on top
    const R = phone ? 1.15 : 1.55;
    SIX.forEach((ids, i) => {
      const a = (i / 6) * Math.PI * 2 + 0.35;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const top = stack(L[4], ids.concat([18 + i]), x, z, 0.62, 0, a);
      L[4].p[18 + i].s *= 1.35; // the maker's mark reads at a glance
      L[4].tops.push([x, top, z]);
    });
    L[4].ring = R;
    // 5 contact: one tall totem with an empty, lit slot (phone: one piece fewer, a taller bay)
    if (phone) stack(L[5], CONTACT.filter((id) => id !== 5), 0, 0, 0.98, 0, 0, 0.84);
    else stack(L[5], CONTACT, 0, 0, 0.98);
    // park everything that is off in a chapter above the frame, near where it will land
    for (let k = 0; k < L.length; k++) {
      for (let i = 0; i < N; i++) {
        const p = L[k].p[i];
        if (p.on) continue;
        let src = null;
        for (let d = 1; d < L.length && !src; d++) {
          if (L[k + d]?.p[i].on) src = L[k + d].p[i];
          else if (L[k - d]?.p[i].on) src = L[k - d].p[i];
        }
        p.x = src ? src.x : 0;
        p.z = src ? src.z : 0;
        p.s = src ? src.s : 0.6;
        p.ry = src ? src.ry : 0;
        p.y = 7.5 + (i % 6) * 0.45;
        p.order = src ? src.order : 0;
      }
    }
    return L;
  }
  const LAY = { desk: layouts(false), phone: layouts(true) };

  // camera rigs: target, distance, azimuth, elevation, lens shift (content moves by sx*W, sy*H)
  const RIG = {
    desk: [
      { tx: 0, ty: 1.56, tz: 0, d: 9.0, az: -0.32, el: 0.05, sx: 0.215, sy: -0.02 },
      { tx: 0, ty: 0.42, tz: 0, d: 12.2, az: -0.1, el: 0.18, sx: 0.228, sy: -0.03 },
      { tx: 1.1, ty: 0.75, tz: 0, d: 10.2, az: 0.98, el: 0.1, sx: 0.125, sy: 0.0 },
      { tx: 0, ty: 1.15, tz: 0, d: 10.2, az: 0.16, el: 0.08, sx: 0.232, sy: 0.0 },
      { tx: 0, ty: 0.4, tz: 0, d: 9.4, az: 0.25, el: 0.62, sx: 0.225, sy: -0.03 },
      { tx: 0, ty: 1.86, tz: 0, d: 9.8, az: -0.52, el: 0.13, sx: 0.19, sy: -0.02 },
    ],
    phone: [
      { tx: 0, ty: 1.52, tz: 0, d: 14.8, az: -0.32, el: 0.06, sx: 0, sy: 0.112 },
      { tx: 0, ty: 0.32, tz: 0.1, d: 13.8, az: -0.12, el: 0.5, sx: 0, sy: 0.12 },
      { tx: 0.45, ty: 0.75, tz: 0, d: 13.8, az: 1.08, el: 0.26, sx: 0, sy: 0.08 },
      { tx: 0.05, ty: 1.15, tz: 0, d: 13.2, az: 0.12, el: 0.08, sx: 0, sy: 0.08 },
      { tx: 0, ty: 0.38, tz: 0, d: 12.2, az: 0.25, el: 0.7, sx: 0, sy: 0.07 },
      { tx: 0, ty: 1.84, tz: 0, d: 16.2, az: -0.5, el: 0.12, sx: 0, sy: 0.11 },
    ],
  };
  const CARD_H = [39, 39, 30, 33, 30, 38];
  const rig = { tx: 0, ty: 0, tz: 0, d: 10, az: 0, el: 0, sx: 0, sy: 0 };

  /* ---- overlay DOM ---- */
  let lineNo = 0;
  const lineStart = [];
  const GAP = 1;
  const blocksHtml = BLOCKS.map((b, bi) => {
    lineStart.push(lineNo + bi * GAP);
    const lines = b.lines
      .map((ln, li) => {
        lineNo++;
        return `<div class="source-ln" data-b="${bi}" data-l="${li}"${li === b.run ? ' data-run="1"' : ''}><span class="source-no">${String(
          lineNo + bi * GAP,
        ).padStart(2, '0')}</span><span class="source-code">${li === b.run ? '<i class="source-bar"></i>' : ''}${highlight(ln)}</span></div>`;
      })
      .join('');
    return `<div class="source-blk" data-b="${bi}">${lines}<div class="source-ln"></div></div>`;
  }).join('');

  const headsHtml = HEADS.map(
    (h, i) =>
      `<div class="source-head${h.hero ? ' is-hero' : ''}${h.narrow ? ' is-narrow' : ''}" data-i="${i}" style="color:${FIELD_INK[i]}"><span class="source-eyebrow">${h.eyebrow}</span><h2 class="source-title source-display">${h.title}</h2></div>`,
  ).join('');

  const cardsHtml = CARDS.map((c, i) => {
    const h = HEADS[i];
    let body = '';
    if (c.chips) body += `<div class="source-chips">${c.chips.map((x) => `<span>${x}</span>`).join('')}</div>`;
    if (c.body) body += `<p>${c.body}</p>`;
    // each service bullet is a tiny stack of its totem's colours, bottom to top
    if (c.list)
      body += `<ul>${c.list
        .map((s, j) => `<li><i class="source-gl">${SIX[j].map((id) => `<b style="background:${TONE_HEX[POOL[id][1]]}"></b>`).join('')}</i>${s}</li>`)
        .join('')}</ul>`;
    if (c.form)
      body += `<div class="source-form"><span>name<em>Your name</em></span><span>email<em>you@company.com</em></span></div>`;
    if (c.cta || c.form) body += `<span class="source-cbtn">&#9654; Start a project</span>`;
    return `<div class="source-cc${h.hero ? ' is-hero' : ''}" data-i="${i}" style="color:${FIELD_INK[i]}"><span class="source-eyebrow">${h.eyebrow}</span><h2 class="source-title source-display">${h.title}</h2>${body}</div>`;
  }).join('');

  const laneHtml = BLOCKS.map(
    (b, i) =>
      `<div class="source-lane-ln"><i>${String(lineStart[i] + (b.laneNo ?? b.run) + 1).padStart(2, '0')}</i><span>${highlight(b.lane)}</span></div>`,
  ).join('');

  const labelDefs = [];
  // hero: the live value, pinned to the crown it describes
  labelDefs.push({ sec: 0, kind: 'finish', html: `<span class="source-tag">finish: <em>"<b class="source-xv">vermilion</b>"</em></span>`, phone: false, right: true });
  // services: six tags on two shared baselines, one stem down to each totem
  SERVICES.forEach((s, i) => labelDefs.push({ sec: 1, kind: 'svc', html: `<span class="source-tag">${s}</span>`, totem: i, line: i % 2, phone: false }));
  [5, 3, 1].forEach((t, j) =>
    labelDefs.push({ sec: 2, kind: 'tag', html: `<span class="source-tag"><em>&#9675;</em> Sample project 0${j + 1}</span>`, totem: t, phone: j < 2 }),
  );
  PLANS.forEach((p, i) =>
    labelDefs.push({ sec: 3, kind: 'plan', html: `<span class="source-plan"><b>${p}</b><small>Sample name<br>Price set in admin</small></span>`, totem: i, phone: false, below: true, stem: false }),
  );
  // team: all six signed; front totems carry the tag under the base, back ones above the coin
  const devAz = RIG.desk[4].az;
  SIX.forEach((_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const front = Math.cos(a - devAz) > 0;
    labelDefs.push({ sec: 4, kind: 'dev', html: `<span class="source-tag"><em>${esc(MARKS[i])}</em> Sample developer</span>`, totem: i, phone: false, below: front, front });
  });
  labelDefs.push({ sec: 5, kind: 'slot', html: `<span class="source-tag">yourProject <em>&rarr;</em></span>`, phone: true, left: true });
  const labelsHtml = labelDefs
    .map((l) => {
      const cls = `source-lbl${l.below ? ' is-below' : ''}${l.left ? ' is-left' : ''}${l.right ? ' is-right' : ''}`;
      const stem = l.stem === false ? '' : '<i class="source-stem"></i>';
      const inner = l.below || l.right ? stem + l.html : l.html + stem;
      return `<div class="${cls}"><span>${inner}</span></div>`;
    })
    .join('');

  overlay.innerHTML = `<div class="source-root">
    <div class="source-navbg"></div>
    <header class="source-nav">
      <span class="source-brand source-display">ProDevly<i></i></span>
      <nav class="source-links"><span>Services</span><span>Projects</span><span>Pricing</span><span>Developers</span><span>Contact</span></nav>
      <span class="source-run">&#9654; Start a project</span>
      <span class="source-burger"><i></i><i></i></span>
    </header>
    <div class="source-pane"></div>
    <div class="source-slab"><i class="source-wipe"></i>${headsHtml}</div>
    <div class="source-ed"><div class="source-buf">${blocksHtml}<i class="source-caret"></i></div></div>
    <div class="source-status"><span class="source-file">src/home.ts</span><span class="source-pos">Ln 07</span><span>running</span></div>
    <div class="source-cta"><b>&#9654; Start a project</b></div>
    <div class="source-lbls">${labelsHtml}</div>
    <div class="source-lane"><div class="source-lane-track">${laneHtml}</div></div>
    <div class="source-card"><i class="source-wipe"></i>${cardsHtml}</div>
  </div>`;

  const $ = (s) => overlay.querySelector(s);
  const $$ = (s) => [...overlay.querySelectorAll(s)];
  const rootEl = $('.source-root');
  const slab = $('.source-slab');
  const wipes = $$('.source-wipe');
  const heads = $$('.source-head');
  const card = $('.source-card');
  const ccs = $$('.source-cc');
  const buf = $('.source-buf');
  const caret = $('.source-caret');
  const cta = $('.source-cta');
  const laneTrack = $('.source-lane-track');
  const brandCaret = $('.source-brand i');
  let lastBlink = -1;
  const links = $$('.source-links span');
  const fileEl = $('.source-file');
  const posEl = $('.source-pos');
  const xvs = $$('.source-xv');
  const blkEls = $$('.source-blk');
  const lineEls = BLOCKS.map((b, bi) =>
    $$(`.source-ln[data-b="${bi}"]`).map((el, li) => ({
      el,
      code: el.querySelector('.source-code'),
      bar: el.querySelector('.source-bar'),
      len: plainLen(b.lines[li]),
      last: { clip: -1, vis: -1, run: -1, bar: -1 },
    })),
  );
  const blockLen = BLOCKS.map((b) => b.lines.reduce((s, l) => s + plainLen(l), 0));
  const labelEls = $$('.source-lbl');
  const labelStems = labelEls.map((el) => el.querySelector('.source-stem'));
  const labelBoxes = labelEls.map((el) => el.querySelector('.source-tag, .source-plan'));
  const labelLast = labelEls.map(() => ({ o: -1, stem: -1, tf: '', w: -1, dx: 0 }));
  const lastBlk = blkEls.map(() => -1);
  const headLast = heads.map(() => ({ o: -1, y: 1e9 }));
  const ccLast = ccs.map(() => ({ o: -1, y: 1e9 }));
  let lastField = -1;
  let lastWipe = -1;
  let lastCardH = -1;
  let lastLink = -1;
  let lastCycle = -1;
  let lastBuf = 1e9;
  let lastLane = 1e9;
  let lastCaret = '';
  let lastCta = -1;
  let lastPw = -1;
  let lastCaretRun = -1;
  let phoneClass = null;

  let W = 1;
  let H = 1;

  /* ---- helpers ---- */
  function poseInto(out, L, k, i, p, time) {
    const src = L[k].p[i];
    out.x = src.x; out.y = src.y; out.z = src.z; out.s = src.s; out.ry = src.ry; out.on = src.on; out.order = src.order;
    if (k === 2) {
      // slide along the rail like a deploy log
      out.x += -(p - 0.4) * 7.5;
    } else if (k === 4 && src.on) {
      const a0 = Math.atan2(src.x, src.z) + (p - 0.8) * 1.6 + Math.sin(time * 0.25) * 0.04;
      const R = L[4].ring;
      out.x = Math.sin(a0) * R;
      out.z = Math.cos(a0) * R;
    }
    return out;
  }
  function resize({ width, height, isPhone }) {
    W = width; H = height;
    const dpr = renderer.getPixelRatio();
    const f = Math.min(0.75, 1.1 / dpr);
    const w = Math.max(2, Math.round(width * dpr * f));
    const h = Math.max(2, Math.round(height * dpr * f));
    rtRaw.setSize(w, h);
    rtB.setSize(w, h);
    rtC.setSize(w, h);
    // blur sigma in css px (x), stretched 1.7x vertically like lacquer; taps sit sigma/3 apart
    const sig = (isPhone ? 3.2 : 4.2) * dpr * f;
    blurH.uniforms.uDir.value.set(sig / 3 / w, 0);
    blurV.uniforms.uDir.value.set(0, (sig * 1.7) / 3 / h);
    setPhone(isPhone);
  }
  function setPhone(v) {
    if (phoneClass === v) return;
    phoneClass = v;
    rootEl.classList.toggle('is-phone', v);
    labelLast.forEach((l) => {
      l.o = -1;
      l.w = -1;
    });
  }

  /* ---- frame ---- */
  let clock = 0;
  const camRight = new THREE.Vector3();
  function project(x, y, z) {
    V3.set(x, y, z).project(camera);
    _v.x = (V3.x * 0.5 + 0.5) * W;
    _v.y = (-V3.y * 0.5 + 0.5) * H;
    return _v;
  }
  function update({ progress, time, dt, pointer, isPhone }) {
    if (isPhone !== phoneClass) setPhone(isPhone);
    // monotonic clock: a jump(p, t) moves it forward and later frames continue from there
    clock = Math.max(clock + (dt || 0), time);
    const t = ctx.reducedMotion ? 4.5 : clock;
    const p = clamp(progress, 0, 1);
    const seg = Math.min(4, Math.floor(p / 0.2));
    const u = clamp((p - AT[seg]) / 0.2, 0, 1);
    const L = isPhone ? LAY.phone : LAY.desk;
    const R = isPhone ? RIG.phone : RIG.desk;

    // continuous section index for type, fields and the editor split
    const hv = seg + band(u, 0.3, 0.52);
    const fk = Math.min(4, Math.floor(hv));
    let fw = hv - fk;
    if (fw > 0.965) fw = 1; // the wipe always completes; no sliver of the old field
    fw = Math.round(fw * 1000) / 1000;
    const pw = isPhone ? 46.5 : lerp(PW[fk], PW[fk + 1], fw);

    // camera first (the flight clamp needs it): hold at each chapter, travel while pieces move
    const cu = band(u, 0.2, 0.9);
    const ra = R[seg], rb = R[seg + 1];
    for (const key2 in rig) rig[key2] = lerp(ra[key2], rb[key2], cu);
    const az = rig.az + pointer.x * 0.1;
    const el = clamp(rig.el + pointer.y * 0.05, 0.01, 1.2);
    camera.position.set(
      rig.tx + Math.sin(az) * Math.cos(el) * rig.d,
      rig.ty + Math.sin(el) * rig.d,
      rig.tz + Math.cos(az) * Math.cos(el) * rig.d,
    );
    camera.lookAt(rig.tx, rig.ty, rig.tz);
    camera.setViewOffset(W, H, -rig.sx * W, rig.sy * H, W, H);
    camera.updateMatrixWorld();
    haze.quaternion.copy(camera.quaternion);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const edgeN = pw / 50 - 1 + 0.13; // editor edge in NDC, plus about one piece radius

    // floor: grazing chapters mirror less; the sheen pool follows the shot and takes the field's hue
    fu.uStrength.value = lerp(0.12, 0.3, clamp(rig.el / 0.45, 0, 1));
    fu.uPool.value.set(rig.tx, rig.tz);
    tmpColor.copy(fieldLin[fk]).lerp(fieldLin[fk + 1], fw);
    fu.uSheen.value.copy(sheenBase).lerp(tmpColor, lerp(SHEEN_TINT[fk], SHEEN_TINT[fk + 1], fw));

    // signature: the live value cycles on a timer; the crown rebuilds on the beat
    const cyc = t < 5 ? 0 : Math.floor((t - 5) / 3.2) + 1;
    const cycT = t < 5 ? 1 : clamp((t - 5 - (cyc - 1) * 3.2) / 0.36, 0, 1);
    const ci = cycT < 0.45 ? (cyc + 3) % 4 : cyc % 4;
    mats.crown.color.copy(cycleColors[ci]);
    const pop = cyc === 0 ? 0 : Math.sin(cycT * Math.PI) * 0.2;
    if (ci !== lastCycle) {
      lastCycle = ci;
      xvs.forEach((el) => {
        el.textContent = CYCLE[ci];
        el.style.borderBottomColor = C[CYCLE[ci]];
      });
    }

    // pieces
    for (let i = 0; i < N; i++) {
      const A = poseInto(_a, L, seg, i, p, t);
      const B = poseInto(_b, L, seg + 1, i, p, t);
      const leaving = A.on && !B.on;
      // one piece per beat: stack order sets the beat, i % 3 breaks ties between totems
      const start = leaving ? 0.24 + (10 - A.order) * 0.012 : 0.28 + B.order * 0.04 + (i % 3) * 0.024;
      const k = band(u, start, Math.min(0.97, start + 0.34));
      const both = A.on && B.on;
      const dx = B.x - A.x, dz = B.z - A.z;
      const dist = Math.hypot(dx, dz);
      const arc = Math.sin(Math.PI * k);
      let x = lerp(A.x, B.x, k);
      let y = lerp(A.y, B.y, k) + (both ? arc * (0.45 + dist * 0.16) : 0);
      let z = lerp(A.z, B.z, k);
      const s = lerp(A.s, B.s, k);
      if (both) {
        // per-piece flight lanes so solids pass beside each other, not through
        x += arc * (((i * 3) % 4) - 1.5) * 0.14;
        y += arc * ((i * 5) % 4) * (isPhone ? 0.08 : 0.2);
        z += arc * (((i * 7) % 5) - 2) * 0.38;
      }
      // first load: pieces drop in one per beat
      const cur = k < 0.5 ? A : B;
      if (cur.on) {
        const ti = clamp((t - 0.25 - cur.order * 0.2) / 0.55, 0, 1);
        const e = 1 - Math.pow(1 - ti, 3);
        y += (1 - e) * 5.5;
      }
      // desktop: nothing in flight is guillotined by the editor pane
      if (!isPhone && both && arc > 0.001) {
        V3.set(x, y, z).project(camera);
        if (V3.x < edgeN) {
          V3.x = lerp(V3.x, edgeN, Math.min(1, arc * 4));
          V3.unproject(camera);
          x = V3.x; y = V3.y; z = V3.z;
        }
      }
      const m = pieces[i];
      // landing settle
      const land = B.on ? Math.sin(clamp((k - 0.8) / 0.2, 0, 1) * Math.PI) * 0.09 : 0;
      let sy = s * (1 - land);
      let sxz = s * (1 + land * 0.5);
      if (i === 7) {
        sy *= 1 - pop;
        sxz *= 1 + pop * 0.5;
      }
      m.position.set(x, y, z);
      m.scale.set(sxz, sy, sxz);
      m.rotation.set(arc * 0.22 * (both ? 1 : 0), lerp(A.ry, B.ry, k) + (i === 7 ? t * 0.15 : 0), arc * 0.42 * Math.sign(dx || 1) * (both ? 1 : 0.2));
      m.visible = y < 6.8;

      // contact shadow
      const lift = Math.max(0, y - (isRail(seg, k) ? RAIL_H : 0));
      const o = Math.pow(clamp(1 - lift / 0.75, 0, 1), 2) * 0.82;
      shadowOpacity[i] = m.visible ? o : 0;
      const r = m.userData.r * s * (2.6 + lift * 1.2);
      shP.set(x, 0, z);
      shS.set(r, 1, r);
      shM.compose(shP, shQ, shS);
      shadows.setMatrixAt(i, shM);
    }

    // rail rises out of the table for the deploy chapter
    const railUp = band(p, 0.29, 0.335) * (1 - band(p, 0.472, 0.525));
    rail.position.set(1.15, -RAIL_H - 0.02 + railUp * (RAIL_H + 0.02), 0);
    rail.visible = railUp > 0.001;
    shadowOpacity[N] = railUp * 0.7;
    shP.set(rail.position.x, 0, 0);
    shS.set(10.6, 1, 1.6);
    shM.compose(shP, shQ, shS);
    shadows.setMatrixAt(N, shM);
    shadows.instanceMatrix.needsUpdate = true;
    shadowGeo.attributes.aOpacity.needsUpdate = true;

    // contact: an empty bay framed by capped gold posts, lit from inside
    const contactW = band(p, 0.9, 0.985);
    const lo = pieces[3];
    const hi = pieces[13];
    const slotBottom = lo.position.y + lo.userData.h * lo.scale.y;
    const slotTop = hi.position.y;
    const gap = Math.max(0, slotTop - slotBottom);
    const grow = band(p, 0.93, 0.995);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + 0.9;
      const rr = 0.56 * lo.scale.x;
      postP.set(lo.position.x + Math.sin(a) * rr, slotBottom, lo.position.z + Math.cos(a) * rr);
      postS.set(1, Math.max(0.0001, gap * grow), 1);
      postM.compose(postP, shQ, postS);
      posts.setMatrixAt(j, postM);
      postP.y = slotBottom + gap * grow;
      postS.set(1, 1, 1).multiplyScalar(Math.max(0.0001, grow));
      postM.compose(postP, shQ, postS);
      caps.setMatrixAt(j, postM);
    }
    posts.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    posts.visible = caps.visible = grow > 0.001 && gap > 0.05;
    slotLight.position.set(lo.position.x, slotBottom + gap * 0.7, lo.position.z + 0.1);
    const breathe = 0.85 + Math.sin(t * 2.2) * 0.15;
    slotLight.intensity = contactW * 9 * breathe;
    slotPool.position.set(lo.position.x, slotBottom + 0.004, lo.position.z);
    slotPool.scale.setScalar(1.35 * lo.scale.x);
    poolMat.uniforms.uO.value = contactW * grow * 0.75 * breathe;
    slotPool.visible = contactW > 0.001;
    haze.visible = slotPool.visible;
    haze.position.set(lo.position.x, slotBottom + gap * 0.5, lo.position.z);
    haze.scale.set(1.5 * lo.scale.x, Math.max(0.01, gap * 1.15), 1);
    hazeMat.uniforms.uO.value = contactW * grow * 0.5 * breathe;

    /* ---- overlay ---- */
    if (fk !== lastField) {
      lastField = fk;
      slab.style.backgroundColor = FIELD[fk];
      card.style.backgroundColor = FIELD[fk];
      wipes.forEach((w) => (w.style.backgroundColor = FIELD[fk + 1]));
    }
    if (fw !== lastWipe) {
      lastWipe = fw;
      wipes.forEach((w) => (w.style.transform = `scaleX(${fw})`));
    }
    const pwr = Math.round(pw * 100) / 100;
    if (pwr !== lastPw) {
      lastPw = pwr;
      rootEl.style.setProperty('--pw', pwr + 'cqw');
    }
    const ch = Math.round(lerp(CARD_H[fk], CARD_H[fk + 1], hv - fk) * 10) / 10;
    if (ch !== lastCardH) {
      lastCardH = ch;
      card.style.height = ch + 'cqh';
    }
    for (let i = 0; i < heads.length; i++) {
      const d = hv - i;
      const o = clamp(1 - Math.abs(d) * 2.2, 0, 1);
      const y = Math.round(-d * 40) / 10;
      writeFade(heads[i], headLast[i], o, y, 'cqh');
      writeFade(ccs[i], ccLast[i], o, y, 'cqh');
    }
    const li = Math.round(hv) - 1;
    if (li !== lastLink) {
      lastLink = li;
      links.forEach((el, j) => el.classList.toggle('is-on', j === li));
      const bi = li + 1;
      fileEl.textContent = 'src/' + BLOCKS[bi].file;
      posEl.textContent = 'Ln ' + String(lineStart[bi] + BLOCKS[bi].run + 1).padStart(2, '0');
    }
    const ctaO = Math.round(clamp(Math.max(1 - hv * 2.2, (hv - 4.55) * 2.2), 0, 1) * 100) / 100;
    if (ctaO !== lastCta) {
      lastCta = ctaO;
      cta.style.opacity = ctaO;
    }

    const blinkOn = (t * 1.25) % 1 < 0.68 ? 1 : 0;
    if (blinkOn !== lastBlink) {
      lastBlink = blinkOn;
      brandCaret.style.opacity = blinkOn;
      caret.style.opacity = blinkOn;
    }

    // phone lane rolls like an odometer
    const lane = Math.round((seg + band(u, 0.3, 0.46)) * 1000) / 1000;
    if (lane !== lastLane) {
      lastLane = lane;
      laneTrack.style.transform = `translateY(${-lane * 5.6}cqh)`;
    }

    if (!isPhone) {
      // source buffer: scroll so the next run line lands on the downbeat row, type it, flash it, run it
      const bufPos = lerp(bufAt(seg), bufAt(seg + 1), band(u, 0.02, 0.15));
      const bp = Math.round(bufPos * 100) / 100;
      if (bp !== lastBuf) {
        lastBuf = bp;
        buf.style.transform = `translateY(${-bp * 2.15}em)`;
      }
      let caretLine = -1;
      let caretCol = 0;
      let caretRun = 0;
      for (let b = 0; b < BLOCKS.length; b++) {
        let f;
        if (b === 0) f = clamp((t - 0.3) / 1.9, 0, 1);
        else if (b <= seg) f = 1;
        else if (b === seg + 1) f = clamp((u - 0.1) / 0.24, 0, 1);
        else f = 0;
        let runS;
        if (b === seg) runS = 1 - band(u, 0.06, 0.14);
        else if (b === seg + 1) runS = band(u, 0.34, 0.4);
        else runS = 0;
        if (b === 0) runS *= band(f, 0.97, 1);
        const blkO = b === seg ? lerp(1, 0.32, band(u, 0.02, 0.15)) : b === seg + 1 ? 1 : 0.32;
        const bo = Math.round(blkO * 100) / 100;
        if (bo !== lastBlk[b]) {
          lastBlk[b] = bo;
          blkEls[b].style.opacity = bo;
        }
        let chars = f * blockLen[b];
        const lines = lineEls[b];
        for (let l = 0; l < lines.length; l++) {
          const ln = lines[l];
          const shown = clamp(chars / ln.len, 0, 1);
          chars -= ln.len;
          const clip = Math.round((1 - shown) * 1000) / 10;
          if (clip !== ln.last.clip) {
            ln.last.clip = clip;
            // fully typed lines open to the right so the run bar's tail and caret show
            ln.code.style.clipPath = clip === 0 ? 'inset(-0.4em -3.4ch -0.4em -1.2ch)' : `inset(-0.4em ${clip}% -0.4em -1.2ch)`;
          }
          const vis = shown > 0 ? 1 : 0;
          if (vis !== ln.last.vis) {
            ln.last.vis = vis;
            ln.el.style.visibility = vis ? 'visible' : 'hidden';
          }
          if (shown > 0 && shown < 1) {
            caretLine = lineStart[b] + l;
            caretCol = Math.round(shown * ln.len);
          }
          if (ln.bar) {
            const bs = Math.round(runS * 100) / 100;
            if (bs !== ln.last.bar) {
              ln.last.bar = bs;
              ln.bar.style.transform = `scaleX(${bs})`;
            }
            const isRun = runS > 0.6 ? 1 : 0;
            if (isRun !== ln.last.run) {
              ln.last.run = isRun;
              ln.el.classList.toggle('is-run', !!isRun);
            }
            if (caretLine < 0 && runS > 0.6) {
              caretLine = lineStart[b] + l;
              caretCol = ln.len + 1;
              caretRun = 1;
            }
          }
        }
      }
      const cs = caretLine >= 0 ? `translate(${4.2 + caretCol}ch, ${(caretLine * 2.15 + 0.45).toFixed(2)}em)` : 'translate(-99em,0)';
      if (cs !== lastCaret) {
        lastCaret = cs;
        caret.style.transform = cs;
      }
      if (caretRun !== lastCaretRun) {
        lastCaretRun = caretRun;
        caret.classList.toggle('is-run', !!caretRun);
      }
    }

    // labels pinned to the pieces, shown once they have landed
    labSeg = seg;
    labOut = 1 - band(u, 0.1, 0.24);
    labIn = band(u, 0.82, 0.97);
    // services share two baselines above the tallest top; plans share one floor line
    let svLine = 0;
    if (!isPhone && secO(1) > 0.001) {
      svLine = 1e9;
      for (let i = 0; i < 6; i++) {
        const tp = pieces[SIX[i][SIX[i].length - 1]];
        svLine = Math.min(svLine, project(tp.position.x, tp.position.y + tp.userData.h * tp.scale.y, tp.position.z).y);
      }
      svLine -= H * 0.03;
    }
    let plLine = 0;
    if (!isPhone && secO(3) > 0.001) {
      plLine = -1e9;
      for (let i = 0; i < 3; i++) {
        const bp0 = pieces[TIERS[i][0]].position;
        plLine = Math.max(plLine, project(bp0.x, 0, bp0.z + 0.95).y);
      }
    }
    const heroIn = clamp((t - 2.5) / 0.4, 0, 1);
    for (let j = 0; j < labelDefs.length; j++) {
      const d = labelDefs[j];
      const el = labelEls[j];
      const ll = labelLast[j];
      let o = secO(d.sec);
      if (d.kind === 'finish') o *= heroIn;
      if (isPhone && !d.phone) o = 0;
      if (o <= 0.001) {
        if (ll.o !== 0) {
          ll.o = 0;
          el.style.opacity = 0;
        }
        continue;
      }
      let sx, sy;
      let stemH = -1;
      if (d.kind === 'finish') {
        const cp = pieces[7];
        const rr = 0.56 * cp.scale.x;
        const q = project(cp.position.x + camRight.x * rr, cp.position.y + cp.userData.h * cp.scale.y * 0.62, cp.position.z + camRight.z * rr);
        sx = q.x; sy = q.y;
      } else if (d.kind === 'slot') {
        const q = project(lo.position.x - (isPhone ? 0.62 : 0.78), slotBottom + gap * 0.5, lo.position.z);
        sx = q.x; sy = q.y;
      } else if (d.kind === 'svc') {
        const tp = pieces[SIX[d.totem][SIX[d.totem].length - 1]];
        const q = project(tp.position.x, tp.position.y + tp.userData.h * tp.scale.y + 0.04, tp.position.z);
        sx = q.x; sy = q.y;
        stemH = Math.max(6, Math.round(sy - (svLine - d.line * H * 0.05)));
      } else if (d.kind === 'plan') {
        const bp0 = pieces[TIERS[d.totem][0]].position;
        sx = project(bp0.x, 0, bp0.z + 0.95).x;
        sy = plLine;
      } else if (d.kind === 'dev') {
        const cp = pieces[18 + d.totem];
        if (d.front) {
          const bx = camera.position.x - cp.position.x;
          const bz = camera.position.z - cp.position.z;
          const bl = Math.hypot(bx, bz) || 1;
          const q = project(cp.position.x + (bx / bl) * 0.5, 0, cp.position.z + (bz / bl) * 0.5);
          sx = q.x; sy = q.y;
        } else {
          const q = project(cp.position.x, cp.position.y + cp.userData.h * cp.scale.y + 0.1, cp.position.z);
          sx = q.x; sy = q.y;
        }
      } else {
        const ids = SIX[d.totem];
        const tp = pieces[ids[ids.length - 1]];
        const q = project(tp.position.x, tp.position.y + tp.userData.h * tp.scale.y + 0.12, tp.position.z);
        sx = q.x; sy = q.y;
      }
      const tf = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
      if (tf !== ll.tf) {
        ll.tf = tf;
        el.style.transform = tf;
      }
      // keep centred tags inside the gutters (and clear of the editor on desktop);
      // the stem stays on its piece, the box slides along it
      if (!d.left && !d.right) {
        if (ll.o <= 0 || ll.w < 0) ll.w = labelBoxes[j].offsetWidth;
        const half = ll.w / 2;
        const g = isPhone ? W * 0.045 : 16;
        const minX = isPhone ? g : (pw * W) / 100 + 14;
        let dx = 0;
        if (sx - half < minX) dx = minX - (sx - half);
        else if (sx + half > W - g) dx = W - g - (sx + half);
        dx = Math.round(clamp(dx, -half + 10, half - 10));
        if (dx !== ll.dx) {
          ll.dx = dx;
          labelBoxes[j].style.transform = dx ? `translateX(${dx}px)` : '';
        }
      }
      if (stemH >= 0 && stemH !== ll.stem && labelStems[j]) {
        ll.stem = stemH;
        labelStems[j].style.height = stemH + 'px';
      }
      const oo = Math.round(o * 100) / 100;
      if (oo !== ll.o) {
        ll.o = oo;
        el.style.opacity = oo;
      }
    }
  }

  // label opacity for a section: fading out of the current one, in to the next
  let labSeg = 0;
  let labOut = 1;
  let labIn = 0;
  function secO(sc) {
    return sc === labSeg ? labOut : sc === labSeg + 1 ? labIn : 0;
  }
  // buffer offset (in lines) that puts block b's run line on its downbeat row
  function bufAt(b) {
    return lineStart[b] + BLOCKS[b].run - ROW[b];
  }

  function isRail(seg, k) {
    return (seg === 1 && k > 0.5) || (seg === 2 && k < 0.5);
  }
  function writeFade(el, last, o, y, unit) {
    const oo = Math.round(o * 100) / 100;
    if (oo !== last.o) {
      last.o = oo;
      el.style.opacity = oo;
      el.style.visibility = oo > 0 ? 'visible' : 'hidden';
    }
    if (y !== last.y) {
      last.y = y;
      el.style.transform = `translateY(${y}${unit})`;
    }
  }

  return {
    update,
    resize,
    dispose() {
      scene.remove(root, rail, posts, caps, slotPool, haze, floor, shadows, key, rim, rim2, hemi, fill, slotLight);
      floor.onBeforeRender = reflect;
      floor.dispose?.();
      posts.dispose();
      caps.dispose();
      shadows.dispose();
      floor.geometry.dispose();
      disposables.forEach((d) => d.dispose?.());
      Object.values(mats).forEach((m) => m.dispose());
      env.dispose();
      scene.environment = prevEnv;
      camera.clearViewOffset();
      overlay.innerHTML = '';
    },
  };
}
