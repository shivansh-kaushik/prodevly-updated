// Studio Standard (canon): a light premium-studio page with one glossy
// extruded "P" monogram in signal-orange lacquer that changes pose per section.
// The monogram is the only 3D object; the overlay carries the real page copy.

import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const meta = {
  id: 'canon',
  title: 'Studio Standard',
  stage: { background: '#F1F2F4', fov: 30, exposure: 1 },
  sections: [
    { key: 'hero', label: 'Hero', at: 0 },
    { key: 'services', label: 'Services', at: 0.2 },
    { key: 'projects', label: 'Projects', at: 0.4 },
    { key: 'pricing', label: 'Pricing', at: 0.6 },
    { key: 'team', label: 'Developers', at: 0.8 },
    { key: 'contact', label: 'Contact', at: 1 },
  ],
  fonts: ['Host+Grotesk:wght@300..800', 'Fragment+Mono'],
};

const C = {
  paper: '#F1F2F4',
  ink: '#111214',
  orange: '#FF5A1F',
  line: '#D5D8DE',
};

export const css = `
.canon-root{position:absolute;inset:0;color:var(--ink);font-family:'Host Grotesk',ui-sans-serif,system-ui,sans-serif;font-weight:400;-webkit-font-smoothing:antialiased;
  --ink:${C.ink};--paper:${C.paper};--orange:${C.orange};--line:${C.line};--muted:#565B65;--soft:#3B3F47;--card:#FFFFFF;
  --thumb:#E7E9EC;--hatch:rgba(17,18,20,.075);--pill:${C.orange};--pill-ink:${C.ink};--pad:3.6cqw}
/* colour fields: projects sit on ink, contact on orange; the canvas background lerps underneath */
.canon-root[data-field="ink"]{--ink:#F1F2F4;--paper:#111214;--line:#2C2E34;--muted:#A7ACB6;--soft:#C9CDD4;--card:#1A1B1F;--thumb:#24262B;--hatch:rgba(241,242,244,.06)}
.canon-root[data-field="orange"]{--line:rgba(17,18,20,.28);--muted:#2B1409;--soft:#1E0F07;--card:#FFFFFF;--pill:#111214;--pill-ink:#F1F2F4}
.canon-root *{box-sizing:border-box}
.canon-mono{font-family:'Fragment Mono',ui-monospace,Menlo,monospace;font-weight:400}

/* nav */
.canon-nav{position:absolute;left:var(--pad);right:var(--pad);top:3.6cqh;display:flex;align-items:center;gap:2.4cqw;font-size:1.02cqw;font-weight:500;z-index:3}
.canon-brand{display:flex;align-items:center;gap:.65cqw;font-weight:700;font-size:1.45cqw;letter-spacing:-.025em}
.canon-mark{inline-size:2cqw;block-size:2cqw;border-radius:.5cqw;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-style:normal;font-weight:800;font-size:1.2cqw;letter-spacing:0}
.canon-links{display:flex;gap:2.3cqw;margin-inline-start:auto}
.canon-links span{position:relative;padding-block:.45cqw;color:var(--muted)}
.canon-links span.is-on{color:var(--ink)}
.canon-links span::after{content:"";position:absolute;left:0;right:0;bottom:0;block-size:2px;background:var(--ink);transform:scaleX(0);transform-origin:left;transition:transform .45s cubic-bezier(.2,.7,.2,1)}
.canon-links span.is-on::after{transform:scaleX(1)}
.canon-pill{display:inline-flex;align-items:center;gap:.9em;background:var(--pill);color:var(--pill-ink);font-weight:600;border-radius:.42em;padding:.86em 1.2em;line-height:1;white-space:nowrap;letter-spacing:-.005em}
.canon-pill i{font-style:normal;font-weight:500}
.canon-menu{display:none}

/* section shells */
.canon-sec{position:absolute;inset:0;opacity:0;visibility:hidden;will-change:opacity,transform}
.canon-eyebrow{font-family:'Fragment Mono',ui-monospace,Menlo,monospace;font-size:.9cqw;letter-spacing:.01em;color:var(--muted);margin:0 0 2.4cqh;display:flex;gap:1em;align-items:center}
.canon-eyebrow b{font-weight:400;color:var(--ink)}
.canon-eyebrow::before{content:"";inline-size:1.6cqw;block-size:1px;background:currentColor;order:1}
.canon-eyebrow b{order:0}
.canon-eyebrow span{order:2}
.canon-h1,.canon-h2,.canon-plan h3{font-family:'Host Grotesk',ui-sans-serif,system-ui,sans-serif}
.canon-h1{font-weight:700;font-size:4.75cqw;line-height:.97;letter-spacing:-.04em;margin:0}
.canon-h1 span{display:block}
.canon-h2{font-weight:700;font-size:3.4cqw;line-height:1;letter-spacing:-.035em;margin:0}
.canon-note{font-size:1.02cqw;line-height:1.5;color:var(--muted);margin:1.8cqh 0 0;max-inline-size:34cqw}

/* hero */
.canon-hero .canon-copy{position:absolute;left:var(--pad);top:20cqh;inline-size:52cqw}
.canon-lede{font-size:1.22cqw;line-height:1.5;color:var(--soft);max-inline-size:30cqw;margin:3.4cqh 0 0}
.canon-ctas{display:flex;align-items:center;gap:1.8cqw;margin-top:4.2cqh;font-size:1.12cqw}
.canon-link{font-weight:600;border-bottom:1.5px solid var(--ink);padding-bottom:.18em}
.canon-strip{position:absolute;left:var(--pad);right:var(--pad);bottom:4.6cqh;border-top:1px solid var(--line);padding-top:2cqh;display:flex;justify-content:space-between;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.9cqw;color:var(--soft)}
.canon-strip b{font-weight:400;color:var(--ink)}

/* services */
.canon-services .canon-copy{position:absolute;left:var(--pad);top:16cqh;inline-size:54cqw}
.canon-list{list-style:none;margin:4.2cqh 0 0;padding:0;border-top:1px solid var(--line)}
.canon-list li{display:grid;grid-template-columns:4.2cqw 15.5cqw 1fr;align-items:baseline;padding:1.9cqh 0;border-bottom:1px solid var(--line)}
.canon-list i{font-style:normal;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.9cqw;color:var(--soft)}
.canon-list b{font-size:1.6cqw;font-weight:600;letter-spacing:-.015em}
.canon-list span{font-size:1.02cqw;color:var(--muted)}

/* projects (always shown on the ink field) */
.canon-head{position:absolute;left:var(--pad);top:15.5cqh;inline-size:62cqw}
.canon-cards{position:absolute;left:var(--pad);right:var(--pad);top:41cqh;bottom:6cqh;display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:1.4cqw}
.canon-card{background:var(--card);border:1px solid var(--line);border-radius:1.1cqw;padding:.75cqw;display:flex;flex-direction:column;gap:1.5cqh;min-height:0}
.canon-thumb{flex:1;min-height:0;border-radius:.65cqw;background-color:var(--thumb);background-image:repeating-linear-gradient(135deg,var(--hatch) 0 1px,transparent 1px 10px);position:relative}
.canon-thumb em{position:absolute;left:.8cqw;top:.8cqw;font-style:normal;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;background:var(--paper);border:1px solid var(--line);border-radius:.4em;padding:.4em .7em;color:var(--ink)}
.canon-thumb b{position:absolute;left:1.1cqw;bottom:1cqw;font-size:2.3cqw;font-weight:600;letter-spacing:-.035em;line-height:1;color:var(--ink)}
.canon-thumb small{position:absolute;right:1cqw;top:1.1cqw;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;color:var(--soft)}
.canon-card:first-child .canon-thumb{background-color:var(--orange);background-image:repeating-linear-gradient(135deg,rgba(17,18,20,.085) 0 1px,transparent 1px 10px)}
.canon-card:first-child .canon-thumb b{color:#111214}
.canon-card:first-child .canon-thumb small{color:#2B1409}
.canon-card:first-child .canon-thumb em{background:#111214;border-color:#111214;color:#F1F2F4}
.canon-meta{display:flex;justify-content:space-between;align-items:baseline;gap:1cqw;padding:0 .35cqw .3cqw}
.canon-meta b{font-size:1.2cqw;font-weight:600;letter-spacing:-.01em}
.canon-meta span{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;color:var(--soft)}

/* pricing: the monogram lies on the featured card, which is an open outlined plinth */
.canon-plans{position:absolute;left:var(--pad);right:var(--pad);top:38cqh;bottom:6cqh;display:grid;grid-template-columns:repeat(3,1fr);gap:1.4cqw}
.canon-plan{background:var(--card);border:1px solid var(--line);border-radius:1.1cqw;padding:1.7cqw;display:flex;flex-direction:column;min-height:0}
.canon-plan.is-key{background:transparent;border:1.5px solid var(--ink)}
.canon-plan.is-key>.canon-tag{margin-top:auto}
.canon-plan.is-key .canon-price{margin-top:2cqh}
.canon-tag{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.88cqw;color:var(--soft);margin:0}
.canon-plan h3{font-size:2.15cqw;font-weight:700;letter-spacing:-.03em;margin:1cqh 0 0}
.canon-plan p{font-size:1cqw;line-height:1.45;color:var(--muted);margin:.9cqh 0 0}
.canon-price{margin-top:auto;border-top:1px solid var(--line);padding-top:1.8cqh;display:flex;justify-content:space-between;align-items:center;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.88cqw}
.canon-price em{font-style:normal;color:var(--soft)}
.canon-btn{margin-top:2cqh;display:flex;justify-content:center;border:1px solid var(--ink);border-radius:.42em;padding:.8em 1em;font-size:1cqw;font-weight:600}
.canon-plan.is-key .canon-pill{margin-top:2cqh;justify-content:center;font-size:1cqw;padding:.8em 1em}
.canon-tabs{display:none}

/* team */
.canon-people{position:absolute;left:var(--pad);right:var(--pad);bottom:6cqh;block-size:30cqh;display:grid;grid-template-columns:repeat(4,1fr);gap:1.4cqw}
.canon-person{background:var(--card);border:1px solid var(--line);border-radius:1.1cqw;padding:.75cqw;display:grid;grid-template-rows:1fr auto;gap:1.3cqh;min-height:0}
.canon-avatar{border-radius:.65cqw;background-color:var(--thumb);background-image:repeating-linear-gradient(135deg,var(--hatch) 0 1px,transparent 1px 10px);position:relative;min-height:0}
.canon-avatar em{position:absolute;left:.7cqw;bottom:.7cqw;font-style:normal;font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;color:var(--soft)}
.canon-who{display:flex;justify-content:space-between;align-items:baseline;padding:0 .3cqw .25cqw}
.canon-who b{font-size:1.12cqw;font-weight:600}
.canon-who span{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;color:var(--soft)}

/* contact (always shown on the orange field): a white card centred inside the black monogram */
.canon-form{--ink:#111214;--muted:#565B65;--soft:#3B3F47;--line:#D5D8DE;--pill:#111214;--pill-ink:#F1F2F4;
  position:absolute;left:50%;transform:translateX(-50%);top:21cqh;bottom:17cqh;inline-size:36cqw;background:#FFFFFF;color:var(--ink);border-radius:1.1cqw;padding:2.3cqw;display:flex;flex-direction:column}
.canon-form .canon-h2{font-size:2.7cqw}
.canon-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 1.6cqw;margin-top:3cqh}
.canon-field{border-bottom:1px solid var(--line);padding:1.4cqh 0 1.1cqh;display:grid;gap:.6cqh}
.canon-field small{font-family:'Fragment Mono',ui-monospace,monospace;font-size:.86cqw;color:var(--soft)}
.canon-field span{font-size:1.04cqw;color:#6B7079}
.canon-field.wide{grid-column:1/-1;border:1px solid var(--line);border-radius:.6cqw;padding:1.3cqh 1cqw;margin-top:2.4cqh;min-height:13cqh;align-content:start}
.canon-send{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:1cqw;font-size:1.05cqw}
.canon-send small{font-size:.9cqw;color:var(--muted);max-inline-size:15cqw;line-height:1.4;text-align:right}
.canon-foot{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:2.4cqw;background:transparent;padding:2.2cqh var(--pad) 3.6cqh;font-size:.95cqw;color:var(--muted)}
.canon-foot b{color:var(--ink);font-weight:700;font-size:1.15cqw;letter-spacing:-.02em}
.canon-foot nav{display:flex;gap:2cqw;margin-inline-start:auto;color:var(--ink)}

/* ---------- phone composition ---------- */
.canon-root.is-phone{--pad:6cqw}
.is-phone .canon-nav{top:3.2cqh;font-size:3.6cqw}
.is-phone .canon-brand{font-size:5.4cqw;gap:2.2cqw}
.is-phone .canon-mark{inline-size:7cqw;block-size:7cqw;border-radius:1.8cqw;font-size:4.2cqw}
.is-phone .canon-links,.is-phone .canon-nav>.canon-pill{display:none}
.is-phone .canon-menu{display:grid;margin-inline-start:auto;inline-size:10cqw;block-size:10cqw;border-radius:50%;border:1px solid var(--line);background:var(--card);place-items:center}
.is-phone .canon-menu::before{content:"";inline-size:4cqw;block-size:1.1cqw;border-block:2px solid var(--ink)}
.is-phone .canon-eyebrow{font-size:3cqw;margin-bottom:1.6cqh}
.is-phone .canon-eyebrow::before{inline-size:5cqw}
.is-phone .canon-h1{font-size:10.4cqw;line-height:.98}
.is-phone .canon-h1 span{display:inline}
.is-phone .canon-h2{font-size:8.6cqw}
.is-phone .canon-note{font-size:3.6cqw;max-inline-size:none;margin-top:1.2cqh}

.is-phone .canon-hero .canon-copy{top:12.5cqh;left:var(--pad);right:var(--pad);inline-size:auto}
.is-phone .canon-hero .canon-lede,.is-phone .canon-hero .canon-ctas{display:none}
.is-phone .canon-strip{display:none}
.is-phone .canon-dock{display:grid}
.canon-dock{display:none;position:absolute;left:var(--pad);right:var(--pad);bottom:4cqh;gap:2.4cqh}
.canon-dock p{margin:0;font-size:3.7cqw;line-height:1.45;color:var(--soft)}
.canon-dock .canon-pill{justify-content:space-between;font-size:4.2cqw;padding:1em 1.2em}

.is-phone .canon-services .canon-copy{top:12.5cqh;left:var(--pad);right:var(--pad);inline-size:auto}
.is-phone .canon-list{position:fixed;display:none}
.canon-svc-card{display:none}
.is-phone .canon-svc-card{display:grid;position:absolute;left:var(--pad);right:var(--pad);bottom:3.6cqh;background:var(--card);border:1px solid var(--line);border-radius:4cqw;padding:1.4cqh 4.5cqw;grid-template-columns:1fr 1fr;column-gap:4cqw}
.canon-svc-card div{display:flex;gap:2.2cqw;align-items:baseline;padding:1.65cqh 0;border-bottom:1px solid var(--line)}
.canon-svc-card div:nth-last-child(-n+2){border-bottom:0}
.canon-svc-card i{font-style:normal;font-family:'Fragment Mono',ui-monospace,monospace;font-size:3cqw;color:var(--soft)}
.canon-svc-card b{font-size:3.9cqw;font-weight:600;letter-spacing:-.01em}

.is-phone .canon-head{top:12.5cqh;left:var(--pad);right:var(--pad);inline-size:auto}
.is-phone .canon-projects .canon-head{right:45cqw}
.is-phone .canon-cards{top:39.5cqh;bottom:auto;block-size:70cqh;grid-template-columns:1fr;grid-template-rows:repeat(2,33cqh);gap:2.4cqh}
.is-phone .canon-card:nth-child(3){display:none}
.is-phone .canon-card{border-radius:4cqw;padding:2.4cqw;gap:1.4cqh}
.is-phone .canon-thumb{border-radius:2.6cqw}
.is-phone .canon-thumb em{font-size:3cqw;left:2.6cqw;top:2.6cqw}
.is-phone .canon-meta b{font-size:4.2cqw}
.is-phone .canon-meta span{font-size:3cqw}
.is-phone .canon-thumb b{font-size:7cqw;left:3cqw;bottom:2.6cqw}
.is-phone .canon-thumb small{font-size:3cqw;right:2.8cqw;top:3.4cqw}

.is-phone .canon-plans{top:auto;bottom:3.6cqh;block-size:30cqh;grid-template-columns:1fr;gap:0}
.is-phone .canon-plan:not(.is-key){display:none}
.is-phone .canon-plan{border-radius:4cqw;padding:5cqw}
.is-phone .canon-plan.is-key{background:var(--card);border:1px solid var(--line)}
.is-phone .canon-plan.is-key>.canon-tag{margin-top:0}
.is-phone .canon-plan.is-key .canon-price{margin-top:auto}
.is-phone .canon-tag{font-size:3cqw}
.is-phone .canon-plan h3{font-size:7.4cqw}
.is-phone .canon-plan p{font-size:3.6cqw}
.is-phone .canon-price{font-size:3cqw}
.is-phone .canon-plan.is-key .canon-pill{font-size:3.9cqw}
.is-phone .canon-tabs{display:flex;position:absolute;left:var(--pad);right:var(--pad);bottom:36cqh;gap:1.6cqw;padding:1.2cqw;border:1px solid var(--line);background:var(--card);border-radius:3cqw}
.canon-tabs span{flex:1;text-align:center;font-size:3.5cqw;font-weight:600;padding:1.1cqh 0;border-radius:2cqw;color:var(--muted)}
.canon-tabs span.is-on{background:var(--ink);color:var(--paper)}

.is-phone .canon-people{block-size:33cqh;bottom:3.6cqh;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2.4cqw}
.is-phone .canon-person{border-radius:3.6cqw;padding:2.2cqw;grid-template-rows:none;grid-template-columns:9cqw 1fr;align-items:center;gap:2.2cqw}
.is-phone .canon-avatar{block-size:9cqw;border-radius:50%}
.is-phone .canon-avatar em{display:none}
.is-phone .canon-who{flex-direction:column;align-items:flex-start;gap:.4cqh;padding:0}
.is-phone .canon-who b{font-size:3.25cqw;white-space:nowrap}
.is-phone .canon-who span{font-size:3cqw}

.is-phone .canon-form{left:var(--pad);right:var(--pad);inline-size:auto;transform:none;top:auto;bottom:3.6cqh;block-size:50cqh;border-radius:4.5cqw;padding:5.4cqw}
.is-phone .canon-form .canon-h2{font-size:7.4cqw}
.is-phone .canon-fields{grid-template-columns:1fr;margin-top:1.6cqh}
.is-phone .canon-field{padding:1.25cqh 0 1cqh;gap:.4cqh}
.is-phone .canon-field.opt{display:none}
.is-phone .canon-field.wide{border:0;border-bottom:1px solid var(--line);border-radius:0;padding:1.25cqh 0 1cqh;margin-top:0;min-height:0}
.is-phone .canon-field small{font-size:3cqw}
.is-phone .canon-field span{font-size:3.7cqw}
.is-phone .canon-send{font-size:3.9cqw}
.is-phone .canon-send small{display:none}
.is-phone .canon-send .canon-pill{flex:1;justify-content:space-between}
.is-phone .canon-foot{display:none}
`;

const SERVICES = [
  ['Web apps', 'Dashboards, portals and customer-facing products.'],
  ['SaaS products', 'Accounts, subscriptions, admin and the product itself.'],
  ['Custom software', 'CRMs, internal tools and workflow systems.'],
  ['Mobile apps', 'iOS and Android apps for your customers or team.'],
  ['UI/UX design', 'Research, flows and interface design.'],
  ['Cloud & DevOps', 'Hosting, deployment pipelines and monitoring.'],
];

function overlayHTML() {
  const pad = (n) => String(n).padStart(2, '0');
  const list = SERVICES.map(
    ([n, d], i) => `<li><i>${pad(i + 1)}</i><b>${n}</b><span>${d}</span></li>`,
  ).join('');
  const svcCard = SERVICES.map(([n], i) => `<div><i>${pad(i + 1)}</i><b>${n}</b></div>`).join('');
  const strip = SERVICES.map(([n], i) => `<span><b>${pad(i + 1)}</b> ${n}</span>`).join('');
  const cards = [
    ['Web app', 'Project name', 'Client · Web app'],
    ['SaaS product', 'Project name', 'Client · SaaS'],
    ['Mobile app', 'Project name', 'Client · Mobile'],
  ]
    .map(
      ([tag, t, m]) =>
        `<article class="canon-card"><div class="canon-thumb"><em>Sample project</em><small>Image from admin</small><b>${tag}</b></div><div class="canon-meta"><b>${t}</b><span>${m}</span></div></article>`,
    )
    .join('');
  const plans = [
    ['Launch', 'For a first version of a product.', false],
    ['Build', 'For a product that is live and growing.', true],
    ['Scale', 'For larger systems, teams and integrations.', false],
  ]
    .map(
      ([n, d, key]) => `<article class="canon-plan${key ? ' is-key' : ''}">
        <p class="canon-tag">Sample plan</p><h3>${n}</h3><p>${d}</p>
        <div class="canon-price"><span>Price</span><em>Set in the admin</em></div>
        ${key ? '<span class="canon-pill">Start a project <i>→</i></span>' : `<span class="canon-btn">Ask about ${n}</span>`}
      </article>`,
    )
    .join('');
  const people = [0, 1, 2, 3]
    .map(
      () =>
        `<article class="canon-person"><div class="canon-avatar"><em>Photo</em></div><div class="canon-who"><b>Developer name</b><span>Role</span></div></article>`,
    )
    .join('');

  return `<div class="canon-root">
  <header class="canon-nav">
    <span class="canon-brand"><i class="canon-mark">P</i>ProDevly</span>
    <nav class="canon-links"><span data-k="1">Services</span><span data-k="2">Work</span><span data-k="3">Pricing</span><span data-k="4">Developers</span><span data-k="5">Contact</span></nav>
    <span class="canon-pill">Start a project <i>→</i></span>
    <span class="canon-menu"></span>
  </header>

  <section class="canon-sec canon-hero">
    <div class="canon-copy">
      <p class="canon-eyebrow"><b>ProDevly</b><span>Web, SaaS and software studio</span></p>
      <h1 class="canon-h1"><span>Web apps, SaaS and</span> <span>custom software,</span> <span>built end to end.</span></h1>
      <p class="canon-lede">We design, build and maintain software for startups, growing businesses and agencies.</p>
      <div class="canon-ctas"><span class="canon-pill">Start a project <i>→</i></span><span class="canon-link">See what we build</span></div>
    </div>
    <div class="canon-strip">${strip}</div>
    <div class="canon-dock"><p>We design, build and maintain software for startups, growing businesses and agencies.</p><span class="canon-pill">Start a project <i>→</i></span></div>
  </section>

  <section class="canon-sec canon-services">
    <div class="canon-copy">
      <p class="canon-eyebrow"><b>01</b><span>Services</span></p>
      <h2 class="canon-h2">What we build</h2>
      <ol class="canon-list">${list}</ol>
    </div>
    <div class="canon-svc-card">${svcCard}</div>
  </section>

  <section class="canon-sec canon-projects">
    <div class="canon-head">
      <p class="canon-eyebrow"><b>02</b><span>Work</span></p>
      <h2 class="canon-h2">Selected projects</h2>
      <p class="canon-note">Sample cards. Real projects are added from the admin panel and appear here.</p>
    </div>
    <div class="canon-cards">${cards}</div>
  </section>

  <section class="canon-sec canon-pricing">
    <div class="canon-head">
      <p class="canon-eyebrow"><b>03</b><span>Pricing</span></p>
      <h2 class="canon-h2">Ways to work with us</h2>
      <p class="canon-note">Plan names here are samples. Names and prices are set in the admin.</p>
    </div>
    <div class="canon-tabs"><span>Launch</span><span class="is-on">Build</span><span>Scale</span></div>
    <div class="canon-plans">${plans}</div>
  </section>

  <section class="canon-sec canon-team">
    <div class="canon-head">
      <p class="canon-eyebrow"><b>04</b><span>Developers</span></p>
      <h2 class="canon-h2">The people who build it</h2>
      <p class="canon-note">Sample profiles. The team is managed in the admin panel.</p>
    </div>
    <div class="canon-people">${people}</div>
  </section>

  <section class="canon-sec canon-contact">
    <div class="canon-form">
      <p class="canon-eyebrow"><b>05</b><span>Contact</span></p>
      <h2 class="canon-h2">Tell us what you’re building.</h2>
      <div class="canon-fields">
        <div class="canon-field"><small>Name</small><span>Your name</span></div>
        <div class="canon-field"><small>Email</small><span>you@company.com</span></div>
        <div class="canon-field opt"><small>Project type</small><span>Web app</span></div>
        <div class="canon-field opt"><small>Company</small><span>Optional</span></div>
        <div class="canon-field wide"><small>Message</small><span>A few lines about the project</span></div>
      </div>
      <div class="canon-send"><span class="canon-pill">Send enquiry <i>→</i></span><small>Your message goes straight to the ProDevly team.</small></div>
    </div>
    <footer class="canon-foot"><b>ProDevly</b><nav><span>Services</span><span>Work</span><span>Pricing</span><span>Developers</span><span>Contact</span></nav><span>© ProDevly</span></footer>
  </section>
</div>`;
}

// ---------- pose tables ----------
// sx, sy: screen position of the monogram centre (0..1, top-left origin)
// d: camera distance; rx/ry/rz: monogram rotation; s: scale
// yaw/pitch: camera orbit; gap: hover above the floor (x scale); sh: shadow strength
const K = ['sx', 'sy', 'd', 'rx', 'ry', 'rz', 's', 'yaw', 'pitch', 'gap', 'sh'];
const POSES = {
  desk: [
    { at: 0.0, sx: 0.635, sy: 0.52, d: 12, rx: 0.05, ry: -0.5, rz: 0.0, s: 1.12, yaw: 0, pitch: 0.12, gap: 0.34, sh: 1 },
    { at: 0.2, sx: 0.83, sy: 0.535, d: 12, rx: 0.02, ry: -1.48, rz: -0.05, s: 1.6, yaw: 0.35, pitch: -0.04, gap: 0.26, sh: 1 },
    { at: 0.4, sx: 0.885, sy: 0.25, d: 12, rx: 0.16, ry: 0.5, rz: 0.1, s: 0.5, yaw: -0.1, pitch: 0.12, gap: 0.26, sh: 0.85 },
    { at: 0.6, sx: 0.5, sy: 0.515, d: 12, rx: -1.5, ry: 0.0, rz: 0.18, s: 0.52, yaw: 0, pitch: 0.62, gap: 0.02, sh: 1 },
    { at: 0.8, sx: 0.64, sy: 0.455, d: 12, rx: 0.0, ry: 0.32, rz: 0.0, s: 1.18, yaw: -0.16, pitch: 0.06, gap: 0.36, sh: 0 },
    { at: 1.0, sx: 0.5, sy: 0.735, d: 12, rx: 0.04, ry: -0.3, rz: 0.04, s: 2.5, yaw: 0.1, pitch: 0.16, gap: 0.3, sh: 0 },
  ],
  phone: [
    { at: 0.0, sx: 0.5, sy: 0.578, d: 15, rx: 0.05, ry: -0.45, rz: 0, s: 0.8, yaw: 0, pitch: 0.12, gap: 0.34, sh: 1 },
    { at: 0.2, sx: 0.5, sy: 0.5, d: 15, rx: 0.02, ry: -1.3, rz: -0.05, s: 1.2, yaw: 0.2, pitch: -0.04, gap: 0.26, sh: 1 },
    { at: 0.4, sx: 0.815, sy: 0.205, d: 15, rx: 0.16, ry: 0.5, rz: 0.1, s: 0.48, yaw: -0.1, pitch: 0.12, gap: 0.26, sh: 0.85 },
    { at: 0.6, sx: 0.5, sy: 0.405, d: 15, rx: -1.12, ry: 0, rz: 0.32, s: 0.6, yaw: 0, pitch: 0.55, gap: 0.12, sh: 1 },
    { at: 0.8, sx: 0.5, sy: 0.48, d: 15, rx: 0, ry: 0.28, rz: 0, s: 0.86, yaw: -0.12, pitch: 0.06, gap: 0.36, sh: 0 },
    { at: 1.0, sx: 0.5, sy: 0.33, d: 15, rx: 0.04, ry: -0.3, rz: 0.04, s: 1.2, yaw: 0.12, pitch: 0.08, gap: 0.3, sh: 0 },
  ],
};
// the monogram holds still for a moment around each section stop, in step with the copy
const HOLD = 0.025;
// colour fields (sRGB hex): paper ground, ink for projects, orange for contact
const FIELD = { paper: C.paper, ink: C.ink, orange: C.orange, lacquer: '#F2501A', lacquerInk: '#141518' };

const SH_RES = 512;

export function create(ctx) {
  const { THREE, scene, camera, renderer, overlay, helpers } = ctx;
  const { band, clamp, lerp } = helpers;
  const reduced = ctx.reducedMotion;

  // ---------- overlay ----------
  overlay.innerHTML = overlayHTML();
  const root = overlay.querySelector('.canon-root');
  const secs = [...root.querySelectorAll('.canon-sec')];
  const links = [...root.querySelectorAll('.canon-links span')];
  const secState = secs.map(() => -1);
  let activeIdx = -1;
  root.classList.toggle('is-phone', ctx.isPhone);

  // ---------- custom studio environment (softboxes, strips, light floor) ----------
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#6d717a');
  const envGeo = new THREE.PlaneGeometry(1, 1);
  const envMats = [];
  function card(w, h, hex, power, x, y, z) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide });
    envMats.push(m);
    const p = new THREE.Mesh(envGeo, m);
    p.scale.set(w, h, 1);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }
  card(40, 40, '#34353a', 1, 0, -6, 0); // dark floor: lower bevels and side walls read deep
  card(12, 7, '#ffffff', 4.2, -8, 9, 8); // big key softbox, top-left front
  card(16, 16, '#ffffff', 1.4, 0, 14, 0); // ceiling bounce
  card(1.4, 14, '#ffffff', 6.0, 11, 3, -7); // rim strip, back right
  card(1.0, 11, '#ffffff', 2.6, 8, 1, 9); // front-right strip
  card(10, 8, '#e9ebef', 0.9, -13, 1, -2); // left fill card
  card(18, 7, '#ffffff', 0.8, 0, 8, 15); // soft front-top card: graded highlight on the face
  card(16, 1.6, '#ffffff', 3.5, 0, 0.9, 13); // crisp stripe in the face's reflection path: sweeps as it turns
  card(8, 9, '#ffffff', 1.1, -9, 1.5, 10); // tall front-left softbox: graded reflection across the big face
  card(7, 9, '#ffffff', 0.9, 10, 1.5, 7.5); // its mirror on the right, for poses that turn the face the other way
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.035);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // ---------- the monogram ----------
  const shape = new THREE.Shape();
  const L = -1.05, T = 1.5, B = -1.5, stemR = -0.25, bowlB = -0.32;
  const R = (T - bowlB) / 2; // bowl outer radius
  const cy = (T + bowlB) / 2;
  const cx = 0.06;
  const r0 = 0.16;
  shape.moveTo(L + r0, B);
  shape.lineTo(stemR - r0, B);
  shape.quadraticCurveTo(stemR, B, stemR, B + r0);
  shape.lineTo(stemR, bowlB - 0.12);
  shape.quadraticCurveTo(stemR, bowlB, stemR + 0.12, bowlB); // rounded inner notch
  shape.lineTo(cx, bowlB);
  shape.absarc(cx, cy, R, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(L + r0, T);
  shape.quadraticCurveTo(L, T, L, T - r0);
  shape.lineTo(L, B + r0);
  shape.quadraticCurveTo(L, B, L + r0, B);
  const ri = 0.34;
  const hole = new THREE.Path();
  const hr = 0.14; // larger than bevelSize so the counter corners never self-intersect
  hole.moveTo(stemR + hr, cy - ri);
  hole.lineTo(cx, cy - ri);
  hole.absarc(cx, cy, ri, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(stemR + hr, cy + ri);
  hole.quadraticCurveTo(stemR, cy + ri, stemR, cy + ri - hr);
  hole.lineTo(stemR, cy - ri + hr);
  hole.quadraticCurveTo(stemR, cy - ri, stemR + hr, cy - ri);
  shape.holes.push(hole);

  const pGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.5,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.09,
    bevelSegments: 10,
    curveSegments: 72,
  });
  pGeo.center();
  // ExtrudeGeometry is non-indexed, so its normals come out flat per facet and the curved walls band
  // under a crisp studio reflection; creased normals smooth every rounded wall and bevel
  const pGeoSmooth = toCreasedNormals(pGeo, Math.PI / 4);
  if (pGeoSmooth !== pGeo) pGeo.dispose();
  const monoGeo = pGeoSmooth;
  { // the two lids (group 0) are flat: keep their normals exact, or the long cap triangles streak
    const lid = monoGeo.groups.find((g) => g.materialIndex === 0);
    const nrm = monoGeo.attributes.normal;
    const pos = monoGeo.attributes.position;
    if (lid) {
      for (let i = lid.start; i < lid.start + lid.count; i++) nrm.setXYZ(i, 0, 0, pos.getZ(i) > 0 ? 1 : -1);
      nrm.needsUpdate = true;
    }
  }
  monoGeo.computeBoundingBox();

  // subtle roughness breakup so the lacquer is not a CG-perfect mirror
  const rCan = document.createElement('canvas');
  rCan.width = rCan.height = 256;
  const rc = rCan.getContext('2d');
  const img = rc.createImageData(256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 205 + rnd() * 50;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  rc.putImageData(img, 0, 0);
  rc.globalAlpha = 0.09;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = 10 + rnd() * 40;
    const g = rc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    rc.fillStyle = g;
    rc.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const roughTex = new THREE.CanvasTexture(rCan);
  roughTex.colorSpace = THREE.NoColorSpace;
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(0.6, 0.6);

  const lacquer = new THREE.MeshPhysicalMaterial({
    color: FIELD.lacquer,
    roughness: 0.42,
    roughnessMap: roughTex,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    specularIntensity: 0.6,
  });
  const mono = new THREE.Mesh(monoGeo, lacquer);
  const tilt = new THREE.Group(); // pose rotation + pointer tilt
  tilt.rotation.order = 'YXZ';
  tilt.add(mono);
  const pivot = new THREE.Group(); // screen placement + scale
  pivot.add(tilt);
  scene.add(pivot);

  // ---------- contact shadow: height map from below, blurred, on the floor ----------
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
  const rtA = new THREE.WebGLRenderTarget(SH_RES, SH_RES, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(SH_RES, SH_RES, rtOpts);
  rtA.texture.generateMipmaps = rtB.texture.generateMipmaps = false;
  const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  shadowCam.rotation.x = Math.PI / 2; // look straight up; image right = +x, image up = +z
  const heightMat = new THREE.ShaderMaterial({
    uniforms: { uFloor: { value: 0 }, uRange: { value: 1 }, uColor: { value: new THREE.Color('#3b1a0c') } },
    vertexShader: `varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uFloor; uniform float uRange; uniform vec3 uColor; varying float vY;
      void main(){ float t = clamp((vY - uFloor) / uRange, 0.0, 1.0); gl_FragColor = vec4(uColor, pow(1.0 - t, 2.2)); }`,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const blurV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const blurF = `uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec4 s = vec4(0.0);
      s += texture2D(tMap, vUv - 4.0*uDir) * 0.051; s += texture2D(tMap, vUv - 3.0*uDir) * 0.0918;
      s += texture2D(tMap, vUv - 2.0*uDir) * 0.12245; s += texture2D(tMap, vUv - uDir) * 0.1531;
      s += texture2D(tMap, vUv) * 0.1633;
      s += texture2D(tMap, vUv + uDir) * 0.1531; s += texture2D(tMap, vUv + 2.0*uDir) * 0.12245;
      s += texture2D(tMap, vUv + 3.0*uDir) * 0.0918; s += texture2D(tMap, vUv + 4.0*uDir) * 0.051;
      gl_FragColor = s; }`;
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: blurV,
    fragmentShader: blurF,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const blurQuad = new THREE.Mesh(quadGeo, blurMat);
  blurQuad.frustumCulled = false;
  const blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const floorGeo = new THREE.PlaneGeometry(1, 1);
  { // flip v so the floor samples the upward-looking capture the right way round
    const uv = floorGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  const floorMat = new THREE.MeshBasicMaterial({ map: rtA.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = 1;
  scene.add(floor);

  // faint orange bounce right under the object (colour bleed from the lacquer)
  const gcv = document.createElement('canvas');
  gcv.width = gcv.height = 128;
  const gctx = gcv.getContext('2d');
  const ggr = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  ggr.addColorStop(0, 'rgba(255,96,40,0.6)');
  ggr.addColorStop(0.5, 'rgba(255,110,60,0.18)');
  ggr.addColorStop(1, 'rgba(255,120,70,0)');
  gctx.fillStyle = ggr;
  gctx.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(gcv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.3 });
  const glow = new THREE.Mesh(floorGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 0;
  scene.add(glow);

  const clearCol = new THREE.Color();
  function renderContactShadow(fx, fy, fz, size, range, blurWorld) {
    shadowCam.left = -size / 2; shadowCam.right = size / 2;
    shadowCam.top = size / 2; shadowCam.bottom = -size / 2;
    shadowCam.near = 0; shadowCam.far = range;
    shadowCam.position.set(fx, fy, fz);
    shadowCam.updateProjectionMatrix();
    shadowCam.updateMatrixWorld();
    heightMat.uniforms.uFloor.value = fy;
    heightMat.uniforms.uRange.value = range;

    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(clearCol);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    mono.material = heightMat;
    renderer.setRenderTarget(rtA);
    renderer.clear();
    renderer.render(pivot, shadowCam);
    mono.material = lacquer;

    const px = blurWorld / (size / SH_RES) / SH_RES; // uv step per tap
    for (let pass = 0; pass < 2; pass++) {
      const k = pass === 0 ? 1 : 0.45;
      blurMat.uniforms.tMap.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(px * k, 0);
      renderer.setRenderTarget(rtB);
      renderer.render(blurQuad, blurCam);
      blurMat.uniforms.tMap.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, px * k);
      renderer.setRenderTarget(rtA);
      renderer.render(blurQuad, blurCam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clearCol, prevAlpha);
  }

  // ---------- lights (speculars and shape; IBL does most of the work) ----------
  const key = new THREE.DirectionalLight('#ffffff', 0.9);
  key.position.set(-5, 8, 6);
  const rim = new THREE.DirectionalLight('#f4f6ff', 1.1);
  rim.position.set(6, 5, -8);
  const hemi = new THREE.HemisphereLight('#ffffff', '#f1e4dc', 0.3);
  scene.add(key, rim, hemi);

  // ---------- scratch ----------
  const pose = new Float32Array(K.length);
  const v3 = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const box = new THREE.Box3();
  const cPaper = new THREE.Color(FIELD.paper);
  const cInk = new THREE.Color(FIELD.ink);
  const cOrange = new THREE.Color(FIELD.orange);
  const cLacq = new THREE.Color(FIELD.lacquer);
  const cLacqInk = new THREE.Color(FIELD.lacquerInk);
  if (!(scene.background && scene.background.isColor)) scene.background = new THREE.Color(FIELD.paper);
  const bg = scene.background;
  let field = '';

  function samplePose(table, p, out) {
    const n = table.length;
    let a = table[0], b = table[0], t = 0;
    if (p >= table[n - 1].at) {
      a = b = table[n - 1];
    } else if (p > table[0].at) {
      for (let i = 0; i < n - 1; i++) {
        if (p >= table[i].at && p <= table[i + 1].at) {
          a = table[i];
          b = table[i + 1];
          t = band(p, a.at + HOLD, b.at - HOLD);
          break;
        }
      }
    }
    for (let k = 0; k < K.length; k++) out[k] = lerp(a[K[k]], b[K[k]], t);
  }

  let phone = ctx.isPhone;

  function setSection(i, w, dir) {
    const el = secs[i];
    const q = Math.round(w * 1000) / 1000;
    if (secState[i] === q) return;
    secState[i] = q;
    if (q <= 0.001) {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      return;
    }
    el.style.visibility = 'visible';
    el.style.opacity = String(q);
    el.style.transform = q >= 0.999 ? 'none' : `translate3d(0, ${((1 - q) * 4 * dir).toFixed(3)}cqh, 0)`;
  }

  return {
    update({ progress, time, pointer, isPhone }) {
      if (isPhone !== phone) {
        phone = isPhone;
        root.classList.toggle('is-phone', phone);
      }
      const p = clamp(progress, 0, 1);

      // colour fields own whole chapters; each swap happens in the gap between two blocks of copy
      const fInk = band(p, 0.27, 0.33) * (1 - band(p, 0.47, 0.53));
      const fOr = band(p, 0.87, 0.93);
      bg.copy(cPaper).lerp(cInk, fInk).lerp(cOrange, fOr);
      lacquer.color.copy(cLacq).lerp(cLacqInk, fOr);
      const f = fOr > 0.5 ? 'orange' : fInk > 0.5 ? 'ink' : 'paper';
      if (f !== field) {
        field = f;
        root.dataset.field = f;
      }
      samplePose(phone ? POSES.phone : POSES.desk, p, pose);
      const sx = pose[0], sy = pose[1], d = pose[2], rx = pose[3], ry = pose[4], rz = pose[5];
      const s = pose[6], yaw = pose[7], pitch = pose[8], gap = pose[9], sh = pose[10];

      // camera orbits a fixed target
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      // place the monogram at its screen position on the camera's focal plane
      const heroW = 1 - band(p, 0.0, 0.16);
      const idle = reduced ? 0 : 1;
      const bob = idle * Math.sin(time * 0.9) * 0.005;
      v3.set(sx * 2 - 1, -((sy + bob) * 2 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
      fwd.copy(camera.position).negate().normalize();
      const along = d / Math.max(0.2, v3.dot(fwd));
      pivot.position.copy(camera.position).addScaledVector(v3, along);
      pivot.scale.setScalar(s);

      const sway = idle * (Math.sin(time * 0.38) * lerp(0.05, 0.3, heroW) + Math.sin(time * 0.23 + 1.3) * 0.04);
      tilt.rotation.set(
        rx - pointer.y * 0.1 + idle * Math.sin(time * 0.31) * 0.025,
        ry + sway + pointer.x * 0.1,
        rz,
      );
      pivot.updateMatrixWorld(true);

      // ground sits under the object; the floor is invisible except for its shadow
      box.copy(monoGeo.boundingBox).applyMatrix4(mono.matrixWorld);
      const floorY = box.min.y - gap * s;
      const fx = (box.min.x + box.max.x) / 2;
      const fz = (box.min.z + box.max.z) / 2;
      const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) + 2.6 * s;
      renderContactShadow(fx, floorY, fz, size, 2.4 * s, 0.05 * s);
      floor.position.set(fx, floorY, fz);
      floor.scale.set(size, size, 1);
      floorMat.opacity = sh * 0.9;
      glow.position.set(fx, floorY - 0.001, fz);
      glow.scale.set(size * 0.4, size * 0.32, 1);
      glowMat.opacity = sh * (0.12 + 0.16 * fInk) * (1 - fOr);

      // overlay sections: hard hand-off, no two blocks overlap
      let cur = 0;
      for (let i = 0; i < secs.length; i++) {
        const at = meta.sections[i].at;
        const w = 1 - band(Math.abs(p - at), 0.072, 0.098);
        setSection(i, w, p < at ? 1 : -1);
        if (p >= at - 0.1) cur = i;
      }
      if (cur !== activeIdx) {
        activeIdx = cur;
        for (let i = 0; i < links.length; i++) links[i].classList.toggle('is-on', i + 1 === cur);
      }
    },
    resize({ isPhone }) {
      phone = isPhone;
      root.classList.toggle('is-phone', isPhone);
    },
    dispose() {
      scene.remove(pivot, floor, glow, key, rim, hemi);
      if (scene.environment === envRT.texture) scene.environment = null;
      bg.copy(cPaper);
      [monoGeo, floorGeo, quadGeo, envGeo].forEach((g) => g.dispose());
      [lacquer, heightMat, blurMat, floorMat, glowMat, ...envMats].forEach((m) => m.dispose());
      [roughTex, glowTex].forEach((t) => t.dispose());
      [rtA, rtB, envRT].forEach((r) => r.dispose());
      overlay.innerHTML = '';
    },
  };
}
